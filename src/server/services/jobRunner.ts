import { and, eq } from 'drizzle-orm';
import type { JobType, MarketplaceId } from '../../shared/constants';
import type { Job } from '../../shared/types';
import { browserManager, onContextClosed } from '../browser/browserManager';
import type { Db } from '../db/client';
import { listings, marketplaceListings, jobs } from '../db/schema';
import { adapterError, AdapterError, toAdapterError } from '../marketplaces/common';
import { getAdapter } from '../marketplaces/registry';
import type { MarketplaceAdapter } from '../marketplaces/types';
import { buildEffectiveListing } from './effectiveListing';
import { events } from './events';
import { preparePhotosForMarketplace } from './imageProcessing';
import { createJobContext, type JobContext } from './jobContext';
import { getJob, getJobRow, isTerminal, setKickHook, updateJob } from './jobs';
import { recomputeListingStatus } from './listingStatus';
import { logger } from './logger';
import { rowToListing, rowToMarketplaceListing } from './mappers';
import { notifyUser } from './notify';
import { listPhotoRows } from './photos';
import { getSettings } from './settings';
import { upsertConnection } from './connections';

const GLOBAL_CAP = 4;
const nowIso = () => new Date().toISOString();

/** Extra job types (status checks, imports) plug in here from later milestones. */
export type JobHandler = (ctx: JobContext, job: Job, adapter: MarketplaceAdapter) => Promise<Record<string, unknown> | void>;
const handlers = new Map<JobType, JobHandler>();
export function registerJobHandler(type: JobType, fn: JobHandler): void { handlers.set(type, fn); }

/** Minute-level hooks (e.g. eBay polling). Run only while the runner is started; failures are logged, never thrown. */
const ticks: Array<(db: Db) => Promise<void> | void> = [];
export function registerTick(fn: (db: Db) => Promise<void> | void): void { ticks.push(fn); }
let tickTimer: NodeJS.Timeout | null = null;

interface Running { controller: AbortController; marketplaceKey: string; promise: Promise<void> }
const running = new Map<string, Running>();

let database: Db | null = null;
let started = false;
let timer: NodeJS.Timeout | null = null;

const keyOf = (job: { marketplaceId: string | null }) => job.marketplaceId ?? '_';

function targetFor(db: Db, job: Job) {
  if (!job.listingId || !job.marketplaceId) return null;
  const row = db.select().from(marketplaceListings).where(and(
    eq(marketplaceListings.listingId, job.listingId), eq(marketplaceListings.marketplaceId, job.marketplaceId),
  )).get();
  return row ? rowToMarketplaceListing(row) : null;
}

function updateTarget(db: Db, job: Job, set: Partial<typeof marketplaceListings.$inferInsert>): void {
  if (!job.listingId || !job.marketplaceId) return;
  db.update(marketplaceListings).set({ ...set, updatedAt: nowIso() }).where(and(
    eq(marketplaceListings.listingId, job.listingId), eq(marketplaceListings.marketplaceId, job.marketplaceId),
  )).run();
}

async function executeJob(db: Db, queued: Job): Promise<void> {
  const controller = running.get(queued.id)!.controller;
  const mp = queued.marketplaceId as MarketplaceId | null;
  const adapter = mp ? getAdapter(mp) : null;
  const scope = (mp ?? 'JOBS').toUpperCase();
  const lc = { jobId: queued.id, listingId: queued.listingId, marketplaceId: mp };
  const input = (getJobRow(db, queued.id).input ?? {}) as { previousStatus?: string };

  const job = updateJob(db, queued.id, { state: 'IN_PROGRESS', startedAt: nowIso() });
  logger.info(scope, `Starting ${job.type}`, lc);
  const settings = getSettings(db);
  const ctx = createJobContext(db, job, controller.signal, settings);

  try {
    if (controller.signal.aborted) throw adapterError('CANCELLED', adapter?.name ?? 'the marketplace');
    let result: Record<string, unknown> | null = null;
    const extra = handlers.get(job.type);

    if (job.type === 'publish' || job.type === 'update') {
      if (!adapter || !job.listingId) throw new Error('publish/update jobs need a marketplace and a listing');
      const listingRow = db.select().from(listings).where(eq(listings.id, job.listingId)).get();
      const ml = targetFor(db, job);
      if (!listingRow || !ml) throw new Error('listing or marketplace listing missing');
      const photoRows = listPhotoRows(db, job.listingId);
      const eff = buildEffectiveListing(rowToListing(listingRow), photoRows, ml, adapter, settings);
      eff.photoPaths = await ctx.step('photos', 'Preparing photos', () =>
        preparePhotosForMarketplace(job.listingId!, adapter.id, photoRows, adapter.photoSpec));
      if (job.type === 'publish') {
        const res = await adapter.publish(ctx, eff);
        updateTarget(db, job, {
          status: 'active', remoteId: res.remoteId, url: res.url, verified: res.verified, listedAt: nowIso(),
          endedAt: null, lastError: null, lastErrorCode: null, lastSyncedAt: nowIso(),
        });
        result = { remoteId: res.remoteId, url: res.url, verified: res.verified };
        logger.info(scope, `Listing published ID: ${res.remoteId ?? '(none)'}`, lc);
      } else {
        if (!adapter.update) throw new Error('adapter has no update()');
        await adapter.update(ctx, eff, ml);
        updateTarget(db, job, { lastSyncedAt: nowIso(), lastError: null, lastErrorCode: null });
      }
    } else if (job.type === 'deactivate') {
      const ml = targetFor(db, job);
      if (!adapter || !ml) throw new Error('marketplace listing missing');
      await adapter.deactivate(ctx, ml);
      updateTarget(db, job, { status: 'ended', endedAt: nowIso() });
    } else if (job.type === 'connect') {
      if (!adapter) throw new Error('connect needs a marketplace');
      const conn = await adapter.connect(ctx);
      upsertConnection(db, adapter.id, conn);
      result = { ...conn };
    } else if (extra) {
      if (!adapter) throw new Error(`${job.type} needs a marketplace`);
      result = (await extra(ctx, job, adapter)) ?? null;
    } else {
      throw new Error(`No handler for job type ${job.type}`);
    }

    updateJob(db, job.id, { state: 'SUCCESS', result, needsUser: null, finishedAt: nowIso() });
  } catch (err) {
    const name = adapter?.name ?? 'the marketplace';
    const reason = controller.signal.reason;
    const e = reason instanceof AdapterError && reason.code === 'BROWSER_CLOSED' ? reason : toAdapterError(err, name);
    if (e.code === 'UNKNOWN') logger.error(scope, `Unexpected error: ${e.detail ?? e.message}`, { ...lc, data: { stack: (err as Error)?.stack } });
    if (controller.signal.aborted && e.code !== 'BROWSER_CLOSED') {
      updateJob(db, job.id, { state: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: 'Cancelled.', needsUser: null, finishedAt: nowIso() });
      if (job.type === 'publish') updateTarget(db, job, { status: input.previousStatus === 'active' ? 'active' : 'not_listed' });
      logger.info(scope, 'Cancelled', lc);
    } else {
      const shot = await ctx.screenshot('failure').catch(() => null);
      void shot;
      updateJob(db, job.id, { state: 'FAILED', errorCode: e.code, errorMessage: e.userMessage, needsUser: null, finishedAt: nowIso() });
      if (job.type === 'publish') updateTarget(db, job, { status: 'error', lastError: e.userMessage, lastErrorCode: e.code });
      else if (job.type === 'deactivate' || job.type === 'update') updateTarget(db, job, { lastError: e.userMessage, lastErrorCode: e.code });
      if (e.code !== 'UNKNOWN') logger.warn(scope, `${job.type} failed: ${e.userMessage}`, lc);
      notifyUser(`${name} failed`, e.userMessage);
    }
  } finally {
    if (job.listingId) recomputeListingStatus(db, job.listingId);
    if (mp) browserManager.markIdle(mp);
  }
}

/** Launch every eligible NOT_STARTED job: one running job per marketplace, at most GLOBAL_CAP in total. */
function pump(db: Db): Promise<void>[] {
  const launched: Promise<void>[] = [];
  const queued = db.select().from(jobs).where(eq(jobs.state, 'NOT_STARTED')).orderBy(jobs.createdAt).all();
  for (const row of queued) {
    if (running.size >= GLOBAL_CAP) break;
    const key = keyOf(row);
    if ([...running.values()].some((r) => r.marketplaceKey === key)) continue;
    if (running.has(row.id)) continue;
    const controller = new AbortController();
    const entry: Running = { controller, marketplaceKey: key, promise: Promise.resolve() };
    running.set(row.id, entry);
    entry.promise = executeJob(db, getJob(db, row.id)).catch((err) => {
      logger.error('JOBS', `Job runner crashed: ${(err as Error).message}`, { jobId: row.id });
    }).finally(() => {
      running.delete(row.id);
      if (started) setImmediate(() => pump(db));
    });
    launched.push(entry.promise);
  }
  return launched;
}

export const jobRunner = {
  start(db: Db): void {
    database = db;
    started = true;
    if (timer) clearInterval(timer);
    timer = setInterval(() => { pump(db); }, 5000);
    timer.unref();
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      for (const fn of ticks) {
        Promise.resolve().then(() => fn(db)).catch((err) => logger.warn('JOBS', `Scheduled task failed: ${(err as Error).message}`));
      }
    }, 60_000);
    tickTimer.unref();
    pump(db);
  },
  kick(): void {
    if (started && database) pump(database);
  },
  async stop(): Promise<void> {
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    for (const r of running.values()) r.controller.abort();
    await Promise.allSettled([...running.values()].map((r) => r.promise));
  },
  /** Tests: run all eligible jobs (and any that become eligible) until none remain running. */
  async runOnce(db: Db | null = database): Promise<void> {
    if (!db) throw new Error('jobRunner.runOnce needs a database');
    for (;;) {
      const launched = pump(db);
      if (launched.length === 0 && running.size === 0) return;
      await Promise.allSettled(launched.length ? launched : [...running.values()].map((r) => r.promise));
    }
  },
  /** Tests: wait for all currently running jobs. */
  async idle(): Promise<void> {
    await Promise.allSettled([...running.values()].map((r) => r.promise));
  },
  isRunning(jobId: string): boolean { return running.has(jobId); },
  /** Abort a running/waiting job. */
  abort(jobId: string): boolean {
    const r = running.get(jobId);
    if (!r) return false;
    r.controller.abort();
    return true;
  },
  /** Abort whatever is running for a marketplace (the browser window was closed). */
  abortMarketplace(mp: MarketplaceId, code: 'BROWSER_CLOSED'): void {
    for (const [id, r] of running) {
      if (r.marketplaceKey !== mp) continue;
      const row = getJobRow(database!, id);
      if (isTerminal(row.state)) continue;
      r.controller.abort(adapterError(code, getAdapter(mp).name));
    }
  },
};

setKickHook(() => jobRunner.kick());
onContextClosed((mp) => {
  if (database) jobRunner.abortMarketplace(mp, 'BROWSER_CLOSED');
  events.publish({ type: 'connection.updated', marketplaceId: mp });
});
