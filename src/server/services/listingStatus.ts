import { eq } from 'drizzle-orm';
import type { ListingStatus } from '../../shared/constants';
import type { Job, Listing, MarketplaceListing, ValidationIssue } from '../../shared/types';
import type { Db } from '../db/client';
import { jobs, listings, marketplaceListings, photos } from '../db/schema';
import { events } from './events';
import { rowToJob, rowToListing, rowToMarketplaceListing } from './mappers';
import { validateCanonical } from './validation';

export function computeListingStatus(
  listing: Pick<Listing, 'archivedAt' | 'soldAt'>,
  mls: Array<Pick<MarketplaceListing, 'status'>>,
  canonicalIssues: ValidationIssue[],
): ListingStatus {
  if (listing.archivedAt) return 'archived';
  if (listing.soldAt) return 'sold';
  const targets = mls.filter((m) => m.status !== 'ended');
  const active = targets.filter((m) => m.status === 'active');
  if (active.length === 0) return canonicalIssues.some((i) => i.severity === 'error') ? 'draft' : 'ready';
  if (active.length < targets.length) return 'partially_listed';
  return 'listed';
}

const LISTING_JOB_TYPES = ['publish', 'update', 'deactivate'];

export function computeNeedsAttention(
  listing: Pick<Listing, 'saleDetectedMarketplaceId' | 'soldAt'>,
  mls: Array<Pick<MarketplaceListing, 'marketplaceId' | 'status'>>,
  allJobs: Array<Pick<Job, 'type' | 'state' | 'marketplaceId' | 'createdAt'>>,
): boolean {
  const relevant = allJobs.filter((j) => LISTING_JOB_TYPES.includes(j.type));
  if (relevant.some((j) => j.state === 'NEEDS_USER')) return true;
  // Most recent job per marketplace; a failure the user already resolved by hand doesn't count.
  const latest = new Map<string, (typeof relevant)[number]>();
  for (const j of relevant) {
    const key = j.marketplaceId ?? '';
    const cur = latest.get(key);
    if (!cur || j.createdAt >= cur.createdAt) latest.set(key, j);
  }
  for (const j of latest.values()) {
    if (j.state !== 'FAILED') continue;
    const ml = mls.find((m) => m.marketplaceId === j.marketplaceId);
    if (j.type === 'publish' && ml?.status === 'active') continue;
    if (j.type === 'deactivate' && ml?.status === 'ended') continue;
    return true;
  }
  if (mls.some((m) => m.status === 'error')) return true;
  if (listing.saleDetectedMarketplaceId) return true;
  if (listing.soldAt && mls.some((m) => m.status === 'active')) return true;
  return false;
}

/** Load, recompute and persist `status`; emits listing.updated. */
export function recomputeListingStatus(db: Db, listingId: string): ListingStatus | null {
  const row = db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!row) return null;
  const listing = rowToListing(row);
  const mls = db.select().from(marketplaceListings).where(eq(marketplaceListings.listingId, listingId)).all().map(rowToMarketplaceListing);
  const photoCount = db.select({ id: photos.id }).from(photos).where(eq(photos.listingId, listingId)).all().length;
  const status = computeListingStatus(listing, mls, validateCanonical(listing, photoCount));
  if (status !== row.status) db.update(listings).set({ status }).where(eq(listings.id, listingId)).run();
  events.publish({ type: 'listing.updated', listingId });
  return status;
}

export function jobsForListing(db: Db, listingId: string): Job[] {
  return db.select().from(jobs).where(eq(jobs.listingId, listingId)).all().map((r) => rowToJob(r));
}
