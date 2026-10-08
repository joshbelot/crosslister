import { execFile } from 'node:child_process';
import { and, eq } from 'drizzle-orm';
import type { MarketplaceId } from '../../shared/constants';
import { MARKETPLACE_ORDER } from '../../shared/constants';
import type { MarketplaceListingPatch } from '../../shared/schemas';
import type { ListingDetail, MarketplaceListing } from '../../shared/types';
import type { Db } from '../db/client';
import { listings, marketplaceListings } from '../db/schema';
import { AppError, notFound } from '../errors';
import { nanoid12 } from '../ids';
import { getAdapter } from '../marketplaces/registry';
import { buildEffectiveListing } from './effectiveListing';
import { events } from './events';
import { preparePhotosForMarketplace } from './imageProcessing';
import { listPhotoRows } from './photos';
import { recomputeListingStatus } from './listingStatus';
import { getListing } from './listings';
import { logger } from './logger';
import { rowToListing, rowToMarketplaceListing } from './mappers';
import { getSettings, setKv } from './settings';

const nowIso = () => new Date().toISOString();

function requireListing(db: Db, id: string) {
  const row = db.select().from(listings).where(eq(listings.id, id)).get();
  if (!row) throw notFound('Listing');
  return row;
}

export function getTarget(db: Db, listingId: string, mp: MarketplaceId): MarketplaceListing | null {
  const row = db.select().from(marketplaceListings)
    .where(and(eq(marketplaceListings.listingId, listingId), eq(marketplaceListings.marketplaceId, mp))).get();
  return row ? rowToMarketplaceListing(row) : null;
}

export function requireTarget(db: Db, listingId: string, mp: MarketplaceId): MarketplaceListing {
  const t = getTarget(db, listingId, mp);
  if (!t) throw notFound('Marketplace listing');
  return t;
}

/** Insert a `not_listed` row when the listing has no row for this marketplace yet. */
export function ensureTarget(db: Db, listingId: string, mp: MarketplaceId): MarketplaceListing {
  getAdapter(mp);
  const existing = getTarget(db, listingId, mp);
  if (existing) return existing;
  const now = nowIso();
  db.insert(marketplaceListings).values({ id: nanoid12(), listingId, marketplaceId: mp, createdAt: now, updatedAt: now }).run();
  return requireTarget(db, listingId, mp);
}

export function updateTarget(db: Db, id: string, patch: Partial<typeof marketplaceListings.$inferInsert>): void {
  db.update(marketplaceListings).set({ ...patch, updatedAt: nowIso() }).where(eq(marketplaceListings.id, id)).run();
}

export function setTargets(db: Db, listingId: string, ids: MarketplaceId[]): ListingDetail {
  requireListing(db, listingId);
  const wanted = [...new Set(ids)];
  const existing = db.select().from(marketplaceListings).where(eq(marketplaceListings.listingId, listingId)).all();
  const added: MarketplaceId[] = [];
  for (const mp of wanted) {
    if (!existing.some((e) => e.marketplaceId === mp)) {
      ensureTarget(db, listingId, mp);
      added.push(mp);
    }
  }
  for (const e of existing) {
    if (!wanted.includes(e.marketplaceId as MarketplaceId) && ['not_listed', 'error', 'ended'].includes(e.status)) {
      db.delete(marketplaceListings).where(eq(marketplaceListings.id, e.id)).run();
    }
  }
  setKv(db, 'last_marketplaces', wanted);
  recomputeListingStatus(db, listingId);
  for (const mp of added) void runPrepare(db, listingId, mp);
  return getListing(db, listingId);
}

export function patchTarget(db: Db, listingId: string, mp: MarketplaceId, patch: MarketplaceListingPatch): MarketplaceListing {
  requireListing(db, listingId);
  const target = requireTarget(db, listingId, mp);
  const set: Partial<typeof marketplaceListings.$inferInsert> = {};
  if (patch.titleOverride !== undefined) set.titleOverride = patch.titleOverride === null || patch.titleOverride.trim() === '' ? null : patch.titleOverride;
  if (patch.descriptionOverride !== undefined) set.descriptionOverride = patch.descriptionOverride === null || patch.descriptionOverride.trim() === '' ? null : patch.descriptionOverride;
  if (patch.priceOverrideCents !== undefined) set.priceOverrideCents = patch.priceOverrideCents;
  if (patch.data !== undefined) set.data = patch.data;
  updateTarget(db, target.id, set);
  recomputeListingStatus(db, listingId);
  return requireTarget(db, listingId, mp);
}

export function removeTarget(db: Db, listingId: string, mp: MarketplaceId): void {
  const target = requireTarget(db, listingId, mp);
  if (target.status === 'active' || target.status === 'in_progress') {
    throw new AppError('TARGET_ACTIVE', 409, 'This listing is live or being published on that marketplace. Deactivate it first.');
  }
  db.delete(marketplaceListings).where(eq(marketplaceListings.id, target.id)).run();
  recomputeListingStatus(db, listingId);
}

export function markListed(db: Db, listingId: string, mp: MarketplaceId, input: { url?: string | null; remoteId?: string | null }): MarketplaceListing {
  const adapter = getAdapter(mp);
  const target = ensureTarget(db, listingId, mp);
  let url = input.url ?? null;
  let remoteId = input.remoteId ?? null;
  if (url) {
    const parsed = adapter.parseListingUrl(url);
    if (parsed) { url = parsed.url; remoteId = remoteId ?? parsed.remoteId; }
  }
  if (!url && remoteId) url = adapter.listingUrl(remoteId);
  updateTarget(db, target.id, {
    status: 'active', url, remoteId, verified: Boolean(url || remoteId), listedAt: nowIso(), endedAt: null,
    lastError: null, lastErrorCode: null,
  });
  logger.info(mp.toUpperCase(), 'Marked as listed', { listingId, marketplaceId: mp });
  recomputeListingStatus(db, listingId);
  return requireTarget(db, listingId, mp);
}

export function markEnded(db: Db, listingId: string, mp: MarketplaceId): MarketplaceListing {
  const target = requireTarget(db, listingId, mp);
  updateTarget(db, target.id, { status: 'ended', endedAt: nowIso(), lastError: null, lastErrorCode: null });
  recomputeListingStatus(db, listingId);
  return requireTarget(db, listingId, mp);
}

export function previewTarget(db: Db, listingId: string, mp: MarketplaceId) {
  const row = requireListing(db, listingId);
  const adapter = getAdapter(mp);
  const ml = getTarget(db, listingId, mp) ?? {
    ...({} as MarketplaceListing), id: '', listingId, marketplaceId: mp, status: 'not_listed' as const, remoteId: null, url: null,
    titleOverride: null, descriptionOverride: null, priceOverrideCents: null, data: {}, verified: true, lastError: null,
    lastErrorCode: null, listedAt: null, endedAt: null, lastSyncedAt: null, createdAt: nowIso(), updatedAt: nowIso(),
  };
  const eff = buildEffectiveListing(rowToListing(row), listPhotoRows(db, listingId), ml, adapter, getSettings(db));
  return {
    title: eff.title, titleTruncated: eff.titleTruncated, description: eff.description,
    priceCents: eff.priceCents, photoCount: eff.photos.length, mapping: adapter.describeMapping(eff),
  };
}

/** Prepare processed photos for a marketplace and (on macOS) open the folder. */
export async function openPhotos(db: Db, listingId: string, mp: MarketplaceId): Promise<{ path: string }> {
  requireListing(db, listingId);
  const adapter = getAdapter(mp);
  const files = await preparePhotosForMarketplace(listingId, mp, listPhotoRows(db, listingId), adapter.photoSpec);
  const { processedDir } = await import('../paths');
  const dir = processedDir(listingId, mp);
  if (process.platform === 'darwin' && files.length) execFile('open', [dir], () => { /* ignore */ });
  return { path: dir };
}

/** Background enrichment hook (e.g. eBay category suggestion). Never throws. */
export async function runPrepare(db: Db, listingId: string, mp: MarketplaceId): Promise<void> {
  try {
    const adapter = getAdapter(mp);
    if (!adapter.prepare) return;
    const row = db.select().from(listings).where(eq(listings.id, listingId)).get();
    const target = getTarget(db, listingId, mp);
    if (!row || !target || !['not_listed', 'error'].includes(target.status)) return;
    const patch = await adapter.prepare(db, rowToListing(row), target);
    if (patch && Object.keys(patch).length) {
      const fresh = getTarget(db, listingId, mp);
      if (fresh) updateTarget(db, fresh.id, { data: { ...fresh.data, ...patch } });
      events.publish({ type: 'listing.updated', listingId });
    }
  } catch (err) {
    logger.warn(mp.toUpperCase(), `prepare failed: ${(err as Error).message}`, { listingId, marketplaceId: mp });
  }
}

/** Run `prepare` for every target of a listing (after title/brand/category edits). */
export function runPrepareForAll(db: Db, listingId: string): void {
  for (const m of db.select().from(marketplaceListings).where(eq(marketplaceListings.listingId, listingId)).all()) {
    if (getAdapter(m.marketplaceId as MarketplaceId).prepare) void runPrepare(db, listingId, m.marketplaceId as MarketplaceId);
  }
}

export const orderedIds = (ids: MarketplaceId[]) => ids.slice().sort((a, b) => MARKETPLACE_ORDER.indexOf(a) - MARKETPLACE_ORDER.indexOf(b));
