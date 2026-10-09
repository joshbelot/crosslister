import fs from 'node:fs';
import path from 'node:path';
import { and, asc, desc, eq, gte, inArray, or } from 'drizzle-orm';
import type { MarketplaceId, StepState } from '../../shared/constants';
import { TERMINAL_JOB_STATES } from '../../shared/constants';
import type { JobType } from '../../shared/constants';
import type { Job, JobStep } from '../../shared/types';
import type { Db } from '../db/client';
import { jobSteps, jobs, listings, marketplaceListings, type JobRow } from '../db/schema';
import { notFound } from '../errors';
import { nanoid12 } from '../ids';
import { paths } from '../paths';
import { errorMessage } from '../marketplaces/common';
import { getAdapter } from '../marketplaces/registry';
import { events } from './events';
import { recomputeListingStatus } from './listingStatus';
import { rowToJob, rowToStep } from './mappers';
import { logger } from './logger';

const nowIso = () => new Date().toISOString();

let kickHook: () => void = () => { /* set by jobRunner */ };
export function setKickHook(fn: () => void): void { kickHook = fn; }

function listingTitle(db: Db, listingId: string | null): string | undefined {
  if (!listingId) return undefined;
  return db.select({ title: listings.title }).from(listings).where(eq(listings.id, listingId)).get()?.title;
}

function loadJob(db: Db, row: JobRow, withSteps: boolean): Job {
  const steps = withSteps ? db.select().from(jobSteps).where(eq(jobSteps.jobId, row.id)).orderBy(asc(jobSteps.seq)).all() : undefined;
  return rowToJob(row, steps, listingTitle(db, row.listingId));
}

export function createJob(
  db: Db,
  j: { type: JobType; marketplaceId: MarketplaceId | null; listingId: string | null; input?: Record<string, unknown>; parentJobId?: string; attempt?: number },
): Job {
  const id = nanoid12();
  db.insert(jobs).values({
    id, type: j.type, marketplaceId: j.marketplaceId, listingId: j.listingId, state: 'NOT_STARTED',
    input: j.input ?? null, attempt: j.attempt ?? 1, parentJobId: j.parentJobId ?? null, createdAt: nowIso(),
  }).run();
  const job = getJob(db, id, { withSteps: true });
  events.publish({ type: 'job.updated', job });
  kickHook();
  return job;
}

export function getJobRow(db: Db, id: string): JobRow {
  const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) throw notFound('Job');
  return row;
}

export function getJob(db: Db, id: string, opts: { withSteps?: boolean } = {}): Job {
  return loadJob(db, getJobRow(db, id), opts.withSteps ?? true);
}

/** Newest first, with steps + listingTitle. `active` = non-terminal or finished within the last 10 minutes. */
export function listJobs(db: Db, q: { listingId?: string; active?: boolean; limit?: number } = {}): Job[] {
  const conds = [];
  if (q.listingId) conds.push(eq(jobs.listingId, q.listingId));
  if (q.active) {
    conds.push(or(
      inArray(jobs.state, ['NOT_STARTED', 'IN_PROGRESS', 'NEEDS_USER']),
      gte(jobs.finishedAt, new Date(Date.now() - 10 * 60_000).toISOString()),
    )!);
  }
  const rows = db.select().from(jobs).where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(q.limit ?? 50).all();
  return rows.map((r) => loadJob(db, r, true));
}

export function updateJob(db: Db, id: string, patch: Partial<JobRow>): Job {
  db.update(jobs).set(patch).where(eq(jobs.id, id)).run();
  const job = getJob(db, id, { withSteps: true });
  events.publish({ type: 'job.updated', job });
  return job;
}

export function addStep(db: Db, jobId: string, key: string, label: string): JobStep {
  const max = db.select({ seq: jobSteps.seq }).from(jobSteps).where(eq(jobSteps.jobId, jobId)).orderBy(desc(jobSteps.seq)).limit(1).get();
  const row = db.insert(jobSteps).values({
    jobId, seq: (max?.seq ?? 0) + 1, key, label, state: 'running', startedAt: nowIso(),
  }).returning().get();
  events.publish({ type: 'job.updated', job: getJob(db, jobId) });
  return rowToStep(row);
}

export function finishStep(db: Db, stepId: number, state: StepState, message?: string, screenshotPath?: string): void {
  const row = db.update(jobSteps).set({
    state, message: message ?? null, finishedAt: nowIso(), ...(screenshotPath ? { screenshotPath } : {}),
  }).where(eq(jobSteps.id, stepId)).returning().get();
  if (row) events.publish({ type: 'job.updated', job: getJob(db, row.jobId) });
}

export function setStepMessage(db: Db, stepId: number, message: string): void {
  const row = db.update(jobSteps).set({ message }).where(eq(jobSteps.id, stepId)).returning().get();
  if (row) events.publish({ type: 'job.updated', job: getJob(db, row.jobId) });
}

export function setStepScreenshot(db: Db, stepId: number, screenshotPath: string): void {
  db.update(jobSteps).set({ screenshotPath }).where(eq(jobSteps.id, stepId)).run();
}

export function isTerminal(state: string): boolean {
  return (TERMINAL_JOB_STATES as string[]).includes(state);
}

/** Startup recovery (05 §6.6). */
export function recoverInterruptedJobs(db: Db): void {
  const now = nowIso();
  const touched = new Set<string>();
  const markTarget = (job: JobRow, set: Partial<typeof marketplaceListings.$inferInsert>) => {
    if (job.type !== 'publish' || !job.listingId || !job.marketplaceId) return;
    db.update(marketplaceListings).set({ ...set, updatedAt: now }).where(and(
      eq(marketplaceListings.listingId, job.listingId), eq(marketplaceListings.marketplaceId, job.marketplaceId),
      eq(marketplaceListings.status, 'in_progress'),
    )).run();
    touched.add(job.listingId);
  };
  for (const job of db.select().from(jobs).where(inArray(jobs.state, ['IN_PROGRESS', 'NEEDS_USER', 'NOT_STARTED'])).all()) {
    const name = job.marketplaceId ? getAdapter(job.marketplaceId as MarketplaceId).name : 'the marketplace';
    if (job.state === 'NOT_STARTED') {
      const prev = (job.input as { previousStatus?: string } | null)?.previousStatus;
      db.update(jobs).set({ state: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: 'Cancelled because the app restarted.', finishedAt: now }).where(eq(jobs.id, job.id)).run();
      markTarget(job, { status: prev === 'active' ? 'active' : 'not_listed' });
    } else {
      const msg = errorMessage('APP_RESTARTED', name);
      db.update(jobs).set({ state: 'FAILED', needsUser: null, errorCode: 'APP_RESTARTED', errorMessage: msg, finishedAt: now }).where(eq(jobs.id, job.id)).run();
      markTarget(job, { status: 'error', lastError: msg, lastErrorCode: 'APP_RESTARTED' });
    }
    logger.warn('JOBS', `Recovered interrupted ${job.type} job`, { jobId: job.id, listingId: job.listingId, marketplaceId: job.marketplaceId as MarketplaceId | null });
  }
  for (const id of touched) recomputeListingStatus(db, id);
  purgeOldScreenshots(14);
}

export function purgeOldScreenshots(days: number): void {
  try {
    const cutoff = Date.now() - days * 86_400_000;
    for (const f of fs.readdirSync(paths.screenshotsDir)) {
      const p = path.join(paths.screenshotsDir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  } catch { /* directory may not exist */ }
}
