import { and, eq, inArray } from 'drizzle-orm';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { Job, ListingDetail } from '../../shared/types';
import type { Db } from '../db/client';
import { jobs, listings, marketplaceListings } from '../db/schema';
import { AppError, notFound } from '../errors';
import { getAdapter } from '../marketplaces/registry';
import { buildEffectiveListing } from './effectiveListing';
import { createJob } from './jobs';
import { jobRunner } from './jobRunner';
import { getListing } from './listings';
import { logger } from './logger';
import { rowToListing, rowToMarketplaceListing } from './mappers';
import { listPhotoRows } from './photos';
import { getSettings } from './settings';

export interface PriceChangeRow {
  marketplaceId: MarketplaceId;
  name: string;
  kind: 'api' | 'browser' | 'manual';
  currentPriceCents: number | null;   // what the marketplace has now (listedPriceCents, else the current effective price)
  newPriceCents: number | null;       // effective price after the change
  hasOverride: boolean;               // a per-marketplace price override exists
  canPush: boolean;                   // the app can change it there (update job)
  note: string | null;                // why it can't, or a warning
  url: string | null;
}

function effectivePrice(db: Db, listingRow: typeof listings.$inferSelect, mlRow: typeof marketplaceListings.$inferSelect, priceCents: number, clearOverride: boolean): number | null {
  const mp = mlRow.marketplaceId as MarketplaceId;
  const ml = rowToMarketplaceListing({ ...mlRow, priceOverrideCents: clearOverride ? null : mlRow.priceOverrideCents });
  return buildEffectiveListing(rowToListing({ ...listingRow, priceCents }), listPhotoRows(db, listingRow.id), ml, getAdapter(mp), getSettings(db)).priceCents;
}

export function previewPriceChange(db: Db, listingId: string, priceCents: number, clearOverrides: boolean): PriceChangeRow[] {
  const listingRow = db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listingRow) throw notFound('Listing');
  const active = db.select().from(marketplaceListings)
    .where(and(eq(marketplaceListings.listingId, listingId), eq(marketplaceListings.status, 'active'))).all();
  return active.map((row) => {
    const mp = row.marketplaceId as MarketplaceId;
    const adapter = getAdapter(mp);
    const newPrice = effectivePrice(db, listingRow, row, priceCents, clearOverrides);
    const current = row.listedPriceCents ?? effectivePrice(db, listingRow, row, listingRow.priceCents ?? 0, false);
    const canUpdate = adapter.capabilities.update !== 'none' && adapter.capabilities.update !== 'manual' && typeof adapter.update === 'function';
    let note: string | null = null;
    let canPush = canUpdate;
    if (!canUpdate) note = `Change it yourself on ${adapter.name}.`;
    if (newPrice !== null && newPrice < adapter.capabilities.minPriceCents) { canPush = false; note = `Below ${adapter.name}'s minimum price.`; }
    if (row.priceOverrideCents !== null && !clearOverrides) note = note ?? `Has its own price (${(row.priceOverrideCents / 100).toFixed(2)}), which stays.`;
    return {
      marketplaceId: mp, name: MARKETPLACE_NAMES[mp], kind: adapter.kind, currentPriceCents: current, newPriceCents: newPrice,
      hasOverride: row.priceOverrideCents !== null, canPush, note, url: row.url,
    };
  });
}

export function applyPriceChange(db: Db, listingId: string, body: { priceCents: number; marketplaceIds: MarketplaceId[]; clearOverrides: boolean }):
  { listing: ListingDetail; jobs: Job[]; skipped: Array<{ marketplaceId: MarketplaceId; reason: string }> } {
  const listingRow = db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listingRow) throw notFound('Listing');
  if (listingRow.soldAt) throw new AppError('ALREADY_SOLD', 409, 'This item is marked as sold.');
  const rows = previewPriceChange(db, listingId, body.priceCents, body.clearOverrides);
  const now = new Date().toISOString();
  db.update(listings).set({ priceCents: body.priceCents, updatedAt: now }).where(eq(listings.id, listingId)).run();
  if (body.clearOverrides && body.marketplaceIds.length) {
    db.update(marketplaceListings).set({ priceOverrideCents: null, updatedAt: now })
      .where(and(eq(marketplaceListings.listingId, listingId), inArray(marketplaceListings.marketplaceId, body.marketplaceIds))).run();
  }
  const created: Job[] = [];
  const skipped: Array<{ marketplaceId: MarketplaceId; reason: string }> = [];
  for (const mp of body.marketplaceIds) {
    const r = rows.find((x) => x.marketplaceId === mp);
    if (!r) { skipped.push({ marketplaceId: mp, reason: 'Not listed there' }); continue; }
    if (!r.canPush) { skipped.push({ marketplaceId: mp, reason: r.note ?? 'Not supported' }); continue; }
    const open = db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.listingId, listingId), eq(jobs.marketplaceId, mp), eq(jobs.type, 'update'), inArray(jobs.state, ['NOT_STARTED', 'IN_PROGRESS', 'NEEDS_USER']),
    )).get();
    if (open) { skipped.push({ marketplaceId: mp, reason: 'An update is already running' }); continue; }
    created.push(createJob(db, { type: 'update', marketplaceId: mp, listingId, input: { previousStatus: 'active', fields: ['price'] } }));
  }
  logger.info('JOBS', `Price change to ${(body.priceCents / 100).toFixed(2)}: ${created.length} update job(s), ${skipped.length} skipped`, { listingId });
  jobRunner.kick();
  return { listing: getListing(db, listingId), jobs: created, skipped };
}
