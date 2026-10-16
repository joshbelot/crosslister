import type { Page } from 'playwright';
import type { MarketplaceId } from '../../shared/constants';
import type { Job, MarketplacePrefs, NeedsUserRequest, Settings } from '../../shared/types';
import type { Db } from '../db/client';
import { JobTrace } from '../browser/trace';
import type { BrowserAdapter } from '../marketplaces/types';

export interface JobContext {
  db: Db; job: Job; marketplaceId: MarketplaceId; adapterName: string;
  settings: Settings; prefs: MarketplacePrefs;
  signal: AbortSignal;
  log: { debug(m: string, d?: unknown): void; info(m: string, d?: unknown): void; warn(m: string, d?: unknown): void; error(m: string, d?: unknown): void };
  /** Required step. Records a step row; on throw marks it failed (+screenshot) and rethrows. */
  step<T>(key: string, label: string, fn: () => Promise<T>): Promise<T>;
  /** Optional step. On throw: step state 'needs_user', message "Couldn't fill automatically — please fill “<label>” in the browser", push label to missingFields, return false. */
  tryStep(key: string, label: string, fn: () => Promise<void>): Promise<boolean>;
  missingFields: string[];
  /** Pause for the user. Resolves when POST /continue arrives. Rejects with CANCELLED on cancel. */
  requestUser(req: NeedsUserRequest): Promise<{ url: string | null }>;
  /** Pause for the user OR resolve automatically when `detect` resolves first (detect gets an AbortSignal that aborts when the user answers). */
  requestUserUntil<T>(req: NeedsUserRequest, detect: (signal: AbortSignal) => Promise<T>): Promise<{ by: 'detected'; value: T } | { by: 'user'; url: string | null }>;
  throwIfCancelled(): void;
  /** The job's trace, or null when traces are off. */
  trace: JobTrace | null;
  /** Called once by the job runner when the job is over. */
  finishTrace(result: { state: string; errorCode: string | null; errorMessage: string | null }): Promise<void>;
  sleep(ms: number): Promise<void>;           // cancellable
  page(): Promise<Page>;                      // browser adapters: browserManager.getPage(mp)
  screenshot(label: string): Promise<string | null>;
  /** Update the message of the step that is currently running (e.g. "Found 12 listings…"). */
  progress(message: string): void;
}

// ---------------------------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------------------------
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { jobSteps } from '../db/schema';
import { browserManager } from '../browser/browserManager';
import { adapterError, AdapterError, toAdapterError } from '../marketplaces/common';
import { paths } from '../paths';
import { addStep, finishStep, getJobRow, setStepMessage, setStepScreenshot, updateJob } from './jobs';
import { logger } from './logger';
import { notifyUser } from './notify';

interface Waiter { resolve(url: string | null): void; reject(err: unknown): void }
const waiters = new Map<string, Waiter>();

/** Resolve a job waiting for the user. Returns false when nothing is waiting. */
export function resolveWaiter(jobId: string, url: string | null): boolean {
  const w = waiters.get(jobId);
  if (!w) return false;
  waiters.delete(jobId);
  w.resolve(url);
  return true;
}

export function hasWaiter(jobId: string): boolean {
  return waiters.has(jobId);
}

export function createJobContext(db: Db, job: Job, signal: AbortSignal, settings: Settings): JobContext {
  const mp = (job.marketplaceId ?? 'other') as MarketplaceId;
  const scope = mp.toUpperCase();
  const lc = { jobId: job.id, listingId: job.listingId, marketplaceId: job.marketplaceId };
  const adapterName = adapterNameFor(mp);
  let currentStepId: number | null = null;

  const cancelledError = () => (signal.reason instanceof AdapterError ? signal.reason : adapterError('CANCELLED', adapterName));
  const throwIfCancelled = () => { if (signal.aborted) throw cancelledError(); };

  const screenshot = async (label: string): Promise<string | null> => {
    try {
      const page = await browserManager.peekPage(mp);
      if (!page) return null;
      const seq = db.select({ seq: jobSteps.seq }).from(jobSteps).where(eq(jobSteps.jobId, job.id)).orderBy(desc(jobSteps.seq)).limit(1).get()?.seq ?? 0;
      const file = path.join(paths.screenshotsDir, `${job.id}-${seq}-${label.replace(/[^a-z0-9_-]+/gi, '_')}.png`);
      await page.screenshot({ path: file });
      if (currentStepId !== null) setStepScreenshot(db, currentStepId, file);
      return file;
    } catch {
      return null;
    }
  };

  const adapterForTrace = (() => { try { return getAdapter(mp); } catch { return null; } })();
  const loginPattern = adapterForTrace && adapterForTrace.kind === 'browser' ? ((adapterForTrace as BrowserAdapter).auth?.loginUrlPattern ?? null) : null;
  const trace = settings.diagnostics.recordTraces
    ? new JobTrace({ jobId: job.id, type: job.type, marketplaceId: job.marketplaceId, listingId: job.listingId, input: getJobRow(db, job.id).input }, loginPattern)
    : null;

  const ctx: JobContext = {
    db, job, marketplaceId: mp, adapterName, settings, prefs: settings.marketplaces[mp], signal,
    log: {
      debug: (m, d) => logger.debug(scope, m, { ...lc, data: d }),
      info: (m, d) => logger.info(scope, m, { ...lc, data: d }),
      warn: (m, d) => logger.warn(scope, m, { ...lc, data: d }),
      error: (m, d) => logger.error(scope, m, { ...lc, data: d }),
    },
    missingFields: [],

    async step(key, label, fn) {
      throwIfCancelled();
      const step = addStep(db, job.id, key, label);
      currentStepId = step.id;
      trace?.event('step.start', { seq: step.seq, key, label });
      try {
        const out = await fn();
        trace?.event('step.end', { seq: step.seq, key, state: 'done' });
        await trace?.snapshot(`${key}-done`);
        finishStep(db, step.id, 'done');
        return out;
      } catch (err) {
        const e = toAdapterError(err, adapterName);
        trace?.event('error', { code: e.code, message: e.userMessage, detail: e.detail ?? null, stack: String((err as Error)?.stack ?? '').split('\n').slice(0, 8).join('\n') });
        trace?.event('step.end', { seq: step.seq, key, state: 'failed', message: e.userMessage, detail: e.detail ?? e.message, code: e.code });
        if (e.code !== 'CANCELLED') await trace?.snapshot(`${key}-failed`);
        const shot = e.code === 'CANCELLED' ? null : await screenshot(key);
        finishStep(db, step.id, 'failed', e.userMessage, shot ?? undefined);
        throw err;
      }
    },

    async tryStep(key, label, fn) {
      throwIfCancelled();
      const step = addStep(db, job.id, key, label);
      currentStepId = step.id;
      trace?.event('step.start', { seq: step.seq, key, label });
      try {
        await fn();
        trace?.event('step.end', { seq: step.seq, key, state: 'done' });
        await trace?.snapshot(`${key}-done`);
        finishStep(db, step.id, 'done');
        return true;
      } catch (err) {
        const e = toAdapterError(err, adapterName);
        if (signal.aborted || e.code === 'CANCELLED' || e.code === 'BROWSER_CLOSED') {
          trace?.event('step.end', { seq: step.seq, key, state: 'failed', message: e.userMessage, detail: e.detail ?? e.message, code: e.code });
          if (e.code !== 'CANCELLED') await trace?.snapshot(`${key}-failed`);
          finishStep(db, step.id, 'failed', e.userMessage);
          throw err;
        }
        const message = `Couldn't fill automatically — please fill “${label}” in the browser`;
        trace?.event('step.end', { seq: step.seq, key, state: 'needs_user', message, detail: e.detail ?? e.message, code: e.code });
        await trace?.snapshot(`${key}-needs_user`);
        const shot = await screenshot(key);
        finishStep(db, step.id, 'needs_user', message, shot ?? undefined);
        ctx.missingFields.push(label);
        logger.warn(scope, `Step “${label}” needs the user: ${e.detail ?? e.message}`, lc);
        return false;
      }
    },

    async requestUser(req) {
      const r = await ctx.requestUserUntil(req, () => new Promise<never>(() => { /* never detects */ }));
      return { url: r.by === 'user' ? r.url : null };
    },

    async requestUserUntil(req, detect) {
      throwIfCancelled();
      updateJob(db, job.id, { state: 'NEEDS_USER', needsUser: req as unknown as Record<string, unknown> });
      logger.info(scope, `Waiting for user: ${req.title}`, lc);
      notifyUser(req.title, req.instructions);
      try { void browserManager.peekPage(mp).then((p) => p?.bringToFront().catch(() => { /* ignore */ })); } catch { /* ignore */ }

      const child = new AbortController();
      let onAbort: (() => void) | null = null;
      const userAnswer = new Promise<{ by: 'user'; url: string | null }>((resolve, reject) => {
        waiters.set(job.id, { resolve: (url) => resolve({ by: 'user', url }), reject });
        onAbort = () => reject(cancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
      });
      // After the waiter is registered: the snapshot takes a moment and POST /continue may arrive meanwhile.
      trace?.event('needs_user', { reason: req.reason, title: req.title, missingFields: req.missingFields ?? null });
      await trace?.snapshot('needs-user');
      trace?.startNeedsUserWatch();
      const detected = detect(child.signal).then((value) => ({ by: 'detected' as const, value }));
      try {
        const result = await Promise.race([userAnswer, detected]);
        trace?.event('user.answer', { by: result.by, url: result.by === 'user' ? result.url : null });
        return result;
      } finally {
        trace?.stopNeedsUserWatch();
        child.abort();
        waiters.delete(job.id);
        if (onAbort) signal.removeEventListener('abort', onAbort);
        detected.catch(() => { /* detector errors after the race is decided are irrelevant */ });
        userAnswer.catch(() => { /* ditto */ });
        if (!signal.aborted) updateJob(db, job.id, { state: 'IN_PROGRESS', needsUser: null });
      }
    },

    throwIfCancelled,
    trace,
    async finishTrace(result) {
      if (!trace) return;
      try { await trace.finish({ ...result, missingFields: [...ctx.missingFields] }); } catch { /* never break the job */ }
    },

    sleep(ms) {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(cancelledError());
        const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
        const onAbort = () => { clearTimeout(t); reject(cancelledError()); };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },

    page: async () => {
      const p = await browserManager.getPage(mp);
      trace?.attach(p);
      return p;
    },
    screenshot,
    progress(message) { if (currentStepId !== null) setStepMessage(db, currentStepId, message); },
  };
  return ctx;
}

// Adapter display names are resolved lazily to keep this module free of a registry import cycle at load time.
import { getAdapter } from '../marketplaces/registry';
function adapterNameFor(mp: MarketplaceId): string {
  try { return getAdapter(mp).name; } catch { return mp; }
}
