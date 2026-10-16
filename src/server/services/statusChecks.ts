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
import { markSold } from './sales';

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

/** A marketplace says the item sold. Records the sale and (setting) removes it everywhere else; otherwise shows the banner as before. */
export function handleDetectedSale(db: Db, ml: MarketplaceListing, details: { salePriceCents?: number | null; source: 'detected' | 'ebay_api' }): void {
  const l = db.select().from(listings).where(eq(listings.id, ml.listingId)).get();
  if (!l || l.soldAt) return;
  const s = getSettings(db).statusChecks;
  if (!s.autoDelistOnSale) { applyRemoteStatus(db, ml, 'sold'); return; }
  const others = db.select().from(marketplaceListings)
    .where(and(eq(marketplaceListings.listingId, l.id), eq(marketplaceListings.status, 'active'))).all()
    .map((r) => r.marketplaceId as MarketplaceId).filter((m) => m !== ml.marketplaceId);
  const { jobs: created } = markSold(db, l.id, {
    marketplaceId: ml.marketplaceId, soldPriceCents: details.salePriceCents ?? null, deactivateMarketplaceIds: others,
  }, details.source);
  events.publish({ type: 'sale.detected', listingId: l.id, marketplaceId: ml.marketplaceId });
  events.publish({ type: 'listing.updated', listingId: l.id });
  const where = others.map((m) => MARKETPLACE_NAMES[m]).join(', ');
  notifyUser(`Sold on ${MARKETPLACE_NAMES[ml.marketplaceId]}`, others.length ? `${l.title} — removing it from ${where}.` : l.title);
  logger.info('STATUS', `Sale detected on ${MARKETPLACE_NAMES[ml.marketplaceId]}; ${created.length} removal job(s) created`, { listingId: l.id, marketplaceId: ml.marketplaceId });
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
  let status = await ctx.step('check', `Checking ${MARKETPLACE_NAMES[adapter.id]}`, () => adapter.checkStatus!(ctx, ml));
  if (status === 'sold' && adapter.kind === 'browser') {
    // Never remove an item everywhere on one page load: look again after a minute.
    const wait = Number(process.env.CROSSLISTER_SALE_CONFIRM_MS ?? 60_000);
    await ctx.sleep(wait);
    status = await ctx.step('confirm', 'Confirming the sale', () => adapter.checkStatus!(ctx, ml));
  }
  if (status === 'sold') handleDetectedSale(ctx.db, ml, { source: 'detected' });
  else applyRemoteStatus(ctx.db, ml, status);
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
    if (row.remoteId && soldIds.has(row.remoteId)) { handleDetectedSale(db, rowToMarketplaceListing(row), { source: 'ebay_api' }); sold++; }
  }
  logger.info('STATUS', `eBay poll: ${sold} sold of ${active.length} active`);
  return { ran: true, jobs: 0, sold };
}

registerTick((db) => { void pollEbay(db); });

// ---------------------------------------------------------------------------------------------
// Timed sale watch for browser marketplaces (14 §5).
// ---------------------------------------------------------------------------------------------

const BROWSER_LAST_POLL_KEY = 'browser_last_poll';
const MAX_CHECKS_PER_MARKETPLACE = 20;

/** Timed sale watch for browser marketplaces (14 §5). Oldest-checked listings first, at most 20 per marketplace per round. */
export function pollBrowserMarketplaces(db: Db, now = Date.now()): { ran: boolean; jobs: number } {
  const s = getSettings(db).statusChecks;
  if (!s.browserPollingEnabled) return { ran: false, jobs: 0 };
  const last = getKv<number>(db, BROWSER_LAST_POLL_KEY, 0);
  if (now - last < s.browserIntervalMinutes * 60_000) return { ran: false, jobs: 0 };
  const pending = db.select().from(jobs).where(and(eq(jobs.type, 'status_check'), inArray(jobs.state, ['NOT_STARTED', 'IN_PROGRESS', 'NEEDS_USER']))).all();
  if (pending.length > 0) return { ran: false, jobs: 0 };
  setKv(db, BROWSER_LAST_POLL_KEY, now);
  const rows = db.select().from(marketplaceListings).where(eq(marketplaceListings.status, 'active')).all()
    .filter((r) => { try { const a = getAdapter(r.marketplaceId as MarketplaceId); return a.kind === 'browser' && a.capabilities.statusCheck === 'browser' && !!a.checkStatus && !!r.url; } catch { return false; } })
    .sort((a, b) => (a.lastSyncedAt ?? '').localeCompare(b.lastSyncedAt ?? ''));
  const perMp = new Map<string, number>();
  const picked = rows.filter((r) => { const n = perMp.get(r.marketplaceId) ?? 0; if (n >= MAX_CHECKS_PER_MARKETPLACE) return false; perMp.set(r.marketplaceId, n + 1); return true; });
  const created: Job[] = [];
  const seen = new Map<string, number>();
  for (const r of picked) {
    const n = seen.get(r.marketplaceId) ?? 0;
    seen.set(r.marketplaceId, n + 1);
    created.push(createJob(db, { type: 'status_check', marketplaceId: r.marketplaceId as MarketplaceId, listingId: r.listingId, input: { pause: n > 0, timed: true } }));
  }
  if (created.length) logger.info('STATUS', `Timed sale check: ${created.length} listing(s)`);
  return { ran: true, jobs: created.length };
}

registerTick((db) => { pollBrowserMarketplaces(db); });
