import { and, eq, inArray } from 'drizzle-orm';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { Job, MarketplaceListing } from '../../shared/types';
import type { Db } from '../db/client';
import { jobs, listings, marketplaceListings } from '../db/schema';
import { notFound } from '../errors';
import { getAdapter } from '../marketplaces/registry';
import type { RemoteStatus } from '../marketplaces/types';
import { events } from './events';
import { registerJobHandler, registerTick } from './jobRunner';
import { createJob } from './jobs';
import { logger } from './logger';
import { rowToMarketplaceListing } from './mappers';
import { recomputeListingStatus } from './listingStatus';
import { getKv, getSettings, setKv } from './settings';
import { hasUserToken } from '../marketplaces/ebay/auth';
import { tradingCall } from '../marketplaces/ebay/trading';
import { notifyUser } from './notify';

const nowIso = () => new Date().toISOString();

/** Record the outcome of a status check (08 §3). Never marks the listing sold and never deactivates anything. */
export function applyRemoteStatus(db: Db, ml: MarketplaceListing, status: RemoteStatus): void {
  const now = nowIso();
  const mp = ml.marketplaceId;
  const lc = { listingId: ml.listingId, marketplaceId: mp };
  if (status === 'active') {
    db.update(marketplaceListings).set({ lastSyncedAt: now, updatedAt: now }).where(eq(marketplaceListings.id, ml.id)).run();
  } else if (status === 'sold') {
    db.update(marketplaceListings).set({ status: 'sold', endedAt: now, lastSyncedAt: now, updatedAt: now }).where(eq(marketplaceListings.id, ml.id)).run();
    const l = db.select().from(listings).where(eq(listings.id, ml.listingId)).get();
    if (l && !l.soldAt) {
      db.update(listings).set({ saleDetectedMarketplaceId: mp, saleDetectedAt: now, updatedAt: now }).where(eq(listings.id, l.id)).run();
      events.publish({ type: 'sale.detected', listingId: l.id, marketplaceId: mp });
      notifyUser('Sale detected', `${l.title} sold on ${MARKETPLACE_NAMES[mp]}`);
      logger.info('STATUS', `Sale detected on ${MARKETPLACE_NAMES[mp]}`, lc);
    }
  } else if (status === 'ended') {
    db.update(marketplaceListings).set({ status: 'ended', endedAt: now, lastSyncedAt: now, updatedAt: now }).where(eq(marketplaceListings.id, ml.id)).run();
  } else {
    logger.info('STATUS', `Could not tell the status on ${MARKETPLACE_NAMES[mp]}`, lc);
  }
  recomputeListingStatus(db, ml.listingId);
  events.publish({ type: 'listing.updated', listingId: ml.listingId });
}

registerJobHandler('status_check', async (ctx, job, adapter) => {
  if (!job.listingId) throw new Error('status_check needs a listing');
  const row = ctx.db.select().from(marketplaceListings)
    .where(and(eq(marketplaceListings.listingId, job.listingId), eq(marketplaceListings.marketplaceId, adapter.id))).get();
  if (!row) throw notFound('Marketplace listing');
  const ml = rowToMarketplaceListing(row);
  if (!adapter.checkStatus) return { status: 'unknown' };
  const input = (ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()?.input ?? {}) as { pause?: boolean };
  if (input.pause && adapter.kind === 'browser') {
    await ctx.sleep(process.env.CROSSLISTER_IMPORT_DELAY_MS === '0' ? 0 : 5000 + Math.floor(Math.random() * 5000));
  }
  const status = await ctx.step('check', `Checking ${MARKETPLACE_NAMES[adapter.id]}`, () => adapter.checkStatus!(ctx, ml));
  applyRemoteStatus(ctx.db, ml, status);
  return { status };
});

/** Create status_check jobs for the given active marketplace listings; skips unsupported adapters and already-pending checks. */
export function createStatusChecks(db: Db, opts: { listingId?: string; marketplaceIds?: MarketplaceId[] } = {}): Job[] {
  const rows = db.select().from(marketplaceListings).where(eq(marketplaceListings.status, 'active')).all()
    .filter((r) => (!opts.listingId || r.listingId === opts.listingId) && (!opts.marketplaceIds || opts.marketplaceIds.includes(r.marketplaceId as MarketplaceId)));
  const pending = db.select().from(jobs).where(and(eq(jobs.type, 'status_check'), inArray(jobs.state, ['NOT_STARTED', 'IN_PROGRESS', 'NEEDS_USER']))).all();
  const created: Job[] = [];
  const perMarketplace = new Map<string, number>();
  for (const r of rows) {
    const mp = r.marketplaceId as MarketplaceId;
    let adapter;
    try { adapter = getAdapter(mp); } catch { continue; }
    if (adapter.capabilities.statusCheck === 'none' || !adapter.checkStatus) continue;
    if (pending.some((j) => j.listingId === r.listingId && j.marketplaceId === mp)) continue;
    const n = perMarketplace.get(mp) ?? 0;
    perMarketplace.set(mp, n + 1);
    created.push(createJob(db, { type: 'status_check', marketplaceId: mp, listingId: r.listingId, input: { pause: n > 0 } }));
  }
  return created;
}

// ---------------------------------------------------------------------------------------------
// eBay polling (08 §4). Browser marketplaces are never polled on a timer.
// ---------------------------------------------------------------------------------------------

const LAST_POLL_KEY = 'ebay_last_poll';

/** One poll: individual checks for a handful of listings, or a single SoldList call when more than 5 are active. */
export async function pollEbay(db: Db, now = Date.now()): Promise<{ ran: boolean; jobs: number; sold: number }> {
  const s = getSettings(db).statusChecks;
  if (!s.ebayPollingEnabled) return { ran: false, jobs: 0, sold: 0 };
  const last = getKv<number>(db, LAST_POLL_KEY, 0);
  if (now - last < s.ebayIntervalMinutes * 60_000) return { ran: false, jobs: 0, sold: 0 };
  const active = db.select().from(marketplaceListings)
    .where(and(eq(marketplaceListings.marketplaceId, 'ebay'), eq(marketplaceListings.status, 'active'))).all();
  if (active.length === 0) return { ran: false, jobs: 0, sold: 0 };
  const pending = db.select().from(jobs).where(and(eq(jobs.type, 'status_check'), eq(jobs.marketplaceId, 'ebay'), inArray(jobs.state, ['NOT_STARTED', 'IN_PROGRESS']))).all();
  if (pending.length > 0 || !(await hasUserToken())) return { ran: false, jobs: 0, sold: 0 };
  setKv(db, LAST_POLL_KEY, now);

  if (active.length <= 5) {
    return { ran: true, jobs: createStatusChecks(db, { marketplaceIds: ['ebay'] }).length, sold: 0 };
  }
  type Res = { SoldList?: { OrderTransactionArray?: { OrderTransaction?: unknown } } };
  const res = await tradingCall<Res>('GetMyeBaySelling', '<SoldList><Include>true</Include><DurationInDays>7</DurationInDays></SoldList>');
  const soldIds = new Set<string>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (o.ItemID !== undefined) soldIds.add(String(o.ItemID));
      for (const v of Object.values(o)) collect(v);
    }
  };
  collect(res.SoldList);
  let sold = 0;
  for (const row of active) {
    if (row.remoteId && soldIds.has(row.remoteId)) { applyRemoteStatus(db, rowToMarketplaceListing(row), 'sold'); sold++; }
  }
  logger.info('STATUS', `eBay poll: ${sold} sold of ${active.length} active`);
  return { ran: true, jobs: 0, sold };
}

registerTick((db) => { void pollEbay(db); });
