import { and, eq, gte, ne } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import { MARKETPLACE_ORDER } from '../../shared/constants';
import type { Job } from '../../shared/types';
import type { Db } from '../db/client';
import { jobs, listings, marketplaceListings } from '../db/schema';
import { AppError, notFound } from '../errors';
import { getAdapter } from '../marketplaces/registry';
import { createJob } from './jobs';
import { jobRunner } from './jobRunner';
import { recomputeListingStatus } from './listingStatus';
import { logger } from './logger';
import { ensureTarget, orderedIds, requireTarget, updateTarget } from './marketplaceListings';
import { getSettings, setKv } from './settings';
import { buildValidationReport } from './validation';
import { errorMessage } from '../marketplaces/common';

export interface CrosslistResult {
  jobs: Job[];
  skipped: Array<{ marketplaceId: MarketplaceId; reason: string }>;
}

const KIND_RANK = { api: 0, browser: 1, manual: 2 } as const;

function startOfLocalDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function crosslist(db: Db, listingId: string, marketplaceIds: MarketplaceId[]): CrosslistResult {
  if (!db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId)).get()) throw notFound('Listing');
  const ids = [...new Set(marketplaceIds)];
  for (const mp of ids) ensureTarget(db, listingId, mp);

  const report = buildValidationReport(db, listingId, ids);
  if (report.marketplaces.some((m) => !m.ready)) {
    throw new AppError('NOT_READY', 422, 'Some marketplaces need more information.', report);
  }

  const ordered = orderedIds(ids).sort((a, b) => {
    const ka = KIND_RANK[getAdapter(a).kind];
    const kb = KIND_RANK[getAdapter(b).kind];
    return ka !== kb ? ka - kb : MARKETPLACE_ORDER.indexOf(a) - MARKETPLACE_ORDER.indexOf(b);
  });
  const settings = getSettings(db);
  const created: Job[] = [];
  const skipped: CrosslistResult['skipped'] = [];

  for (const mp of ordered) {
    const adapter = getAdapter(mp);
    const target = requireTarget(db, listingId, mp);
    if (target.status === 'active') { skipped.push({ marketplaceId: mp, reason: 'Already listed' }); continue; }
    const open = db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.listingId, listingId), eq(jobs.marketplaceId, mp), eq(jobs.type, 'publish'),
      ne(jobs.state, 'SUCCESS'), ne(jobs.state, 'FAILED'), ne(jobs.state, 'CANCELLED'),
    )).get();
    if (open) { skipped.push({ marketplaceId: mp, reason: 'Already in progress' }); continue; }
    const limit = settings.marketplaces[mp].dailyLimit;
    const today = db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.marketplaceId, mp), eq(jobs.type, 'publish'), ne(jobs.state, 'CANCELLED'), gte(jobs.createdAt, startOfLocalDayIso()),
    )).all().length;
    if (today >= limit) {
      skipped.push({ marketplaceId: mp, reason: errorMessage('DAILY_LIMIT', adapter.name, { limit }).replace(/ You can change it in Settings\.$/, '') });
      continue;
    }
    updateTarget(db, target.id, { status: 'in_progress', lastError: null, lastErrorCode: null });
    created.push(createJob(db, { type: 'publish', marketplaceId: mp, listingId, input: { previousStatus: target.status } }));
  }

  setKv(db, 'last_marketplaces', ids);
  recomputeListingStatus(db, listingId);
  logger.info('JOBS', `Cross-list: ${created.length} job(s) created, ${skipped.length} skipped`, { listingId });
  jobRunner.kick();
  return { jobs: created, skipped };
}
