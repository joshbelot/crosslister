import { and, eq } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import type { markSoldSchema } from '../../shared/schemas';
import type { Job, ListingDetail } from '../../shared/types';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { jobs, listings, marketplaceListings } from '../db/schema';
import { AppError, notFound } from '../errors';
import { getAdapter } from '../marketplaces/registry';
import { buildEffectiveListing } from './effectiveListing';
import { createJob } from './jobs';
import { recomputeListingStatus } from './listingStatus';
import { getListing } from './listings';
import { logger } from './logger';
import { rowToListing } from './mappers';
import { getTarget, updateTarget } from './marketplaceListings';
import { listPhotoRows } from './photos';
import { getSettings } from './settings';

export type MarkSoldInput = z.infer<typeof markSoldSchema>;
const nowIso = () => new Date().toISOString();

function requireListingRow(db: Db, id: string) {
  const row = db.select().from(listings).where(eq(listings.id, id)).get();
  if (!row) throw notFound('Listing');
  return row;
}

function hasOpenDeactivate(db: Db, listingId: string, mp: MarketplaceId): boolean {
  return db.select().from(jobs).where(and(eq(jobs.listingId, listingId), eq(jobs.marketplaceId, mp), eq(jobs.type, 'deactivate'))).all()
    .some((j) => !['SUCCESS', 'FAILED', 'CANCELLED'].includes(j.state));
}

export function deactivateTargets(db: Db, listingId: string, ids?: MarketplaceId[]): Job[] {
  const active = db.select().from(marketplaceListings)
    .where(and(eq(marketplaceListings.listingId, listingId), eq(marketplaceListings.status, 'active'))).all();
  const created: Job[] = [];
  for (const ml of active) {
    const mp = ml.marketplaceId as MarketplaceId;
    if (ids && !ids.includes(mp)) continue;
    if (hasOpenDeactivate(db, listingId, mp)) continue;
    created.push(createJob(db, { type: 'deactivate', marketplaceId: mp, listingId, input: { previousStatus: ml.status } }));
  }
  return created;
}

export function markSold(db: Db, id: string, body: MarkSoldInput): { listing: ListingDetail; jobs: Job[] } {
  const row = requireListingRow(db, id);
  const soldAt = body.soldAt ?? nowIso();
  const mp = body.marketplaceId === 'elsewhere' ? null : body.marketplaceId;

  let soldPrice = body.soldPriceCents ?? null;
  if (soldPrice === null && mp) {
    const ml = getTarget(db, id, mp);
    if (ml) {
      soldPrice = buildEffectiveListing(rowToListing(row), listPhotoRows(db, id), ml, getAdapter(mp), getSettings(db)).priceCents;
    }
  }
  soldPrice ??= row.priceCents;

  db.update(listings).set({
    soldAt, soldPriceCents: soldPrice, soldMarketplaceId: body.marketplaceId,
    saleDetectedMarketplaceId: null, saleDetectedAt: null, updatedAt: nowIso(),
  }).where(eq(listings.id, id)).run();

  if (mp) {
    const ml = getTarget(db, id, mp);
    if (ml) updateTarget(db, ml.id, { status: 'sold', endedAt: soldAt });
  }
  const created = deactivateTargets(db, id, body.deactivateMarketplaceIds.filter((m) => m !== mp));
  recomputeListingStatus(db, id);
  logger.info(mp ? mp.toUpperCase() : 'SERVER', 'Marked sold', { listingId: id, marketplaceId: mp });
  return { listing: getListing(db, id), jobs: created };
}

export function unmarkSold(db: Db, id: string): ListingDetail {
  const row = requireListingRow(db, id);
  if (!row.soldAt) throw new AppError('NOT_SOLD', 409, 'That item is not marked as sold.');
  const mp = row.soldMarketplaceId && row.soldMarketplaceId !== 'elsewhere' ? (row.soldMarketplaceId as MarketplaceId) : null;
  if (mp) {
    const ml = getTarget(db, id, mp);
    if (ml && ml.status === 'sold' && ml.endedAt && Date.now() - new Date(ml.endedAt).getTime() < 24 * 3_600_000) {
      updateTarget(db, ml.id, { status: 'active', endedAt: null });
    }
  }
  db.update(listings).set({ soldAt: null, soldPriceCents: null, soldMarketplaceId: null, updatedAt: nowIso() }).where(eq(listings.id, id)).run();
  recomputeListingStatus(db, id);
  return getListing(db, id);
}

export function dismissSale(db: Db, id: string): ListingDetail {
  requireListingRow(db, id);
  db.update(listings).set({ saleDetectedMarketplaceId: null, saleDetectedAt: null }).where(eq(listings.id, id)).run();
  recomputeListingStatus(db, id);
  return getListing(db, id);
}

