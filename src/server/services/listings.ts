import fs from 'node:fs';
import { and, asc, eq, lt } from 'drizzle-orm';
import {
  INVENTORY_FILTERS, MARKETPLACE_ORDER, TERMINAL_JOB_STATES, type InventoryFilter,
} from '../../shared/constants';
import { listingPatchSchema, type ListingPatch } from '../../shared/schemas';
import { normalizeSize } from '../../shared/sizes';
import { sizeTypeOf } from '../../shared/taxonomy';
import type { Job, ListingDetail, ListingSummary, ShippingInfo } from '../../shared/types';
import type { Db } from '../db/client';
import { jobSteps, jobs, listings, marketplaceListings, photos } from '../db/schema';
import { AppError, notFound } from '../errors';
import { nanoid12 } from '../ids';
import { listingDir } from '../paths';
import { events } from './events';
import { computeNeedsAttention, recomputeListingStatus } from './listingStatus';
import { rowToJob, rowToListing, rowToMarketplaceListing, rowToPhoto } from './mappers';
import { jobRunner } from './jobRunner';
import { clonePhotos } from './photos';
import { getKv, getSettings, setKv } from './settings';

export interface ListQuery {
  filter: InventoryFilter;
  q: string;
  sort: 'updated_desc' | 'created_desc' | 'price_desc' | 'price_asc' | 'title_asc';
}

const nowIso = () => new Date().toISOString();

export function allocateSku(db: Db): string {
  return db.transaction(() => {
    const { next } = getKv<{ next: number }>(db, 'sku_counter', { next: 1 });
    setKv(db, 'sku_counter', { next: next + 1 });
    return `CL-${String(next).padStart(5, '0')}`;
  });
}

function pushRecentCategory(db: Db, categoryId: string | null | undefined): void {
  if (!categoryId) return;
  const cur = getKv<string[]>(db, 'recent_categories', []);
  setKv(db, 'recent_categories', [categoryId, ...cur.filter((c) => c !== categoryId)].slice(0, 8));
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const k = t.trim().toLowerCase();
    if (k && !seen.has(k)) { seen.add(k); out.push(t.trim()); }
  }
  return out;
}

/** Trim / normalize free-text fields of a validated patch. */
function normalizePatch(patch: ListingPatch, categoryId: string | null): ListingPatch {
  const p: ListingPatch = { ...patch };
  if (p.title !== undefined) p.title = p.title.trim();
  if (p.brand !== undefined) p.brand = p.brand.trim();
  if (p.model !== undefined) p.model = p.model.trim();
  if (p.tags !== undefined) p.tags = dedupeTags(p.tags);
  if (p.size !== undefined) p.size = normalizeSize(p.size, sizeTypeOf(p.categoryId !== undefined ? p.categoryId : categoryId));
  return p;
}

export function createListing(db: Db, input: ListingPatch): ListingDetail {
  const patch = normalizePatch(listingPatchSchema.parse(input), input.categoryId ?? null);
  const settings = getSettings(db);
  const now = nowIso();
  const id = nanoid12();
  const shipping: ShippingInfo = { ...settings.shippingDefaults, ...(patch.shipping ?? {}) };
  const sku = allocateSku(db);
  const { measurements, ...rest } = patch;
  db.insert(listings).values({
    ...rest,
    measurements: (measurements ?? {}) as Record<string, number>,
    id, sku, shipping: shipping as unknown as Record<string, unknown>, status: 'draft', source: 'created', createdAt: now, updatedAt: now,
  }).run();
  pushRecentCategory(db, patch.categoryId);
  recomputeListingStatus(db, id);
  return getListing(db, id);
}

function latestJobs(db: Db, listingId?: string): Job[] {
  const rows = listingId
    ? db.select().from(jobs).where(eq(jobs.listingId, listingId)).orderBy(asc(jobs.createdAt)).all()
    : db.select().from(jobs).orderBy(asc(jobs.createdAt)).all();
  return rows.map((r) => rowToJob(r));
}

export function getListing(db: Db, id: string): ListingDetail {
  const row = db.select().from(listings).where(eq(listings.id, id)).get();
  if (!row) throw notFound('Listing');
  const listing = rowToListing(row);
  const photoRows = db.select().from(photos).where(eq(photos.listingId, id)).orderBy(asc(photos.position)).all();
  const mls = db.select().from(marketplaceListings).where(eq(marketplaceListings.listingId, id)).all()
    .map(rowToMarketplaceListing)
    .sort((a, b) => MARKETPLACE_ORDER.indexOf(a.marketplaceId) - MARKETPLACE_ORDER.indexOf(b.marketplaceId));
  const allJobs = latestJobs(db, id);
  const activeRows = allJobs.filter((j) => !TERMINAL_JOB_STATES.includes(j.state));
  const activeJobs = activeRows.map((j) => {
    const steps = db.select().from(jobSteps).where(eq(jobSteps.jobId, j.id)).orderBy(asc(jobSteps.seq)).all();
    return rowToJob(db.select().from(jobs).where(eq(jobs.id, j.id)).get()!, steps, listing.title);
  });
  return {
    ...listing,
    photos: photoRows.map(rowToPhoto),
    marketplaces: mls,
    activeJobs,
    needsAttention: computeNeedsAttention(listing, mls, allJobs),
  };
}

export function updateListing(db: Db, id: string, input: ListingPatch): ListingDetail {
  const current = db.select().from(listings).where(eq(listings.id, id)).get();
  if (!current) throw notFound('Listing');
  const patch = normalizePatch(listingPatchSchema.parse(input), current.categoryId);
  const { measurements, shipping, ...rest } = patch;
  db.update(listings).set({
    ...rest,
    ...(measurements !== undefined ? { measurements: measurements as Record<string, number> } : {}),
    ...(shipping !== undefined ? { shipping: shipping as unknown as Record<string, unknown> } : {}),
    updatedAt: nowIso(),
  }).where(eq(listings.id, id)).run();
  if (patch.categoryId && patch.categoryId !== current.categoryId) pushRecentCategory(db, patch.categoryId);
  recomputeListingStatus(db, id);
  return getListing(db, id);
}

export function deleteListing(db: Db, id: string, opts: { force: boolean }): void {
  const row = db.select().from(listings).where(eq(listings.id, id)).get();
  if (!row) throw notFound('Listing');
  const active = db.select().from(marketplaceListings)
    .where(and(eq(marketplaceListings.listingId, id), eq(marketplaceListings.status, 'active'))).all();
  if (active.length > 0 && !opts.force) {
    throw new AppError('LISTING_HAS_ACTIVE', 409, 'This item is still live on a marketplace. Deactivate it first, or delete anyway.');
  }
  // Stop anything still running for this listing; job and photo rows go away with it (ON DELETE CASCADE).
  for (const j of db.select().from(jobs).where(eq(jobs.listingId, id)).all()) jobRunner.abort(j.id);
  db.delete(listings).where(eq(listings.id, id)).run();
  fs.rmSync(listingDir(id), { recursive: true, force: true });
  events.publish({ type: 'listing.deleted', listingId: id });
}

export async function duplicateListing(db: Db, id: string): Promise<ListingDetail> {
  const row = db.select().from(listings).where(eq(listings.id, id)).get();
  if (!row) throw notFound('Listing');
  const newId = nanoid12();
  const now = nowIso();
  db.insert(listings).values({
    ...row,
    id: newId, sku: allocateSku(db), status: 'draft', source: 'created',
    soldAt: null, soldPriceCents: null, soldMarketplaceId: null,
    saleDetectedMarketplaceId: null, saleDetectedAt: null, archivedAt: null,
    createdAt: now, updatedAt: now,
  }).run();
  const targets = db.select().from(marketplaceListings).where(eq(marketplaceListings.listingId, id)).all();
  for (const t of targets) {
    db.insert(marketplaceListings).values({
      id: nanoid12(), listingId: newId, marketplaceId: t.marketplaceId, status: 'not_listed', createdAt: now, updatedAt: now,
    }).run();
  }
  await clonePhotos(db, id, newId);
  recomputeListingStatus(db, newId);
  return getListing(db, newId);
}

export function archiveListing(db: Db, id: string): ListingDetail {
  if (!db.select({ id: listings.id }).from(listings).where(eq(listings.id, id)).get()) throw notFound('Listing');
  db.update(listings).set({ archivedAt: nowIso(), updatedAt: nowIso() }).where(eq(listings.id, id)).run();
  recomputeListingStatus(db, id);
  return getListing(db, id);
}

export function unarchiveListing(db: Db, id: string): ListingDetail {
  if (!db.select({ id: listings.id }).from(listings).where(eq(listings.id, id)).get()) throw notFound('Listing');
  db.update(listings).set({ archivedAt: null, updatedAt: nowIso() }).where(eq(listings.id, id)).run();
  recomputeListingStatus(db, id);
  return getListing(db, id);
}

export function toSummary(d: ListingDetail): ListingSummary {
  const primary = d.photos[0];
  return {
    id: d.id, sku: d.sku, title: d.title, priceCents: d.priceCents, status: d.status,
    brand: d.brand, size: d.size, categoryId: d.categoryId,
    primaryPhotoUrl: primary ? primary.urls.thumb : null, photoCount: d.photos.length,
    marketplaces: d.marketplaces.map((m) => ({ marketplaceId: m.marketplaceId, status: m.status, url: m.url })),
    needsAttention: d.needsAttention, updatedAt: d.updatedAt, createdAt: d.createdAt,
  };
}

export function listListings(db: Db, q: Partial<ListQuery> = {}): { items: ListingSummary[]; counts: Record<InventoryFilter, number> } {
  const filter = q.filter ?? 'all';
  const sort = q.sort ?? 'updated_desc';
  const terms = (q.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);

  const rows = db.select().from(listings).all();
  const mlRows = db.select().from(marketplaceListings).all().map(rowToMarketplaceListing);
  const photoRows = db.select().from(photos).orderBy(asc(photos.position)).all();
  const jobRows = db.select().from(jobs).orderBy(asc(jobs.createdAt)).all().map((r) => rowToJob(r));

  const mlByListing = new Map<string, typeof mlRows>();
  for (const m of mlRows) (mlByListing.get(m.listingId) ?? mlByListing.set(m.listingId, []).get(m.listingId)!).push(m);
  const photosByListing = new Map<string, typeof photoRows>();
  for (const p of photoRows) (photosByListing.get(p.listingId) ?? photosByListing.set(p.listingId, []).get(p.listingId)!).push(p);
  const jobsByListing = new Map<string, Job[]>();
  for (const j of jobRows) if (j.listingId) (jobsByListing.get(j.listingId) ?? jobsByListing.set(j.listingId, []).get(j.listingId)!).push(j);

  let summaries = rows.map((row): ListingSummary => {
    const listing = rowToListing(row);
    const mls = (mlByListing.get(row.id) ?? [])
      .sort((a, b) => MARKETPLACE_ORDER.indexOf(a.marketplaceId) - MARKETPLACE_ORDER.indexOf(b.marketplaceId));
    const ph = photosByListing.get(row.id) ?? [];
    const primary = ph[0] ? rowToPhoto(ph[0]) : null;
    return {
      id: row.id, sku: row.sku, title: row.title, priceCents: row.priceCents, status: listing.status,
      brand: row.brand, size: row.size, categoryId: row.categoryId,
      primaryPhotoUrl: primary ? primary.urls.thumb : null, photoCount: ph.length,
      marketplaces: mls.map((m) => ({ marketplaceId: m.marketplaceId, status: m.status, url: m.url })),
      needsAttention: computeNeedsAttention(listing, mls, jobsByListing.get(row.id) ?? []),
      updatedAt: row.updatedAt, createdAt: row.createdAt,
    };
  });

  if (terms.length) {
    const hay = new Map(rows.map((r) => [r.id, [r.title, r.brand, r.sku, r.size, r.description, r.model].join(' \n ').toLowerCase()]));
    summaries = summaries.filter((s) => terms.every((t) => hay.get(s.id)!.includes(t)));
  }

  const matches = (s: ListingSummary, f: InventoryFilter): boolean => {
    switch (f) {
      case 'all': return s.status !== 'archived';
      case 'draft': return s.status === 'draft' || s.status === 'ready';
      case 'listed': return s.status === 'listed';
      case 'partially_listed': return s.status === 'partially_listed';
      case 'sold': return s.status === 'sold';
      case 'archived': return s.status === 'archived';
      case 'needs_attention': return s.needsAttention && s.status !== 'archived';
    }
  };
  const counts = Object.fromEntries(INVENTORY_FILTERS.map((f) => [f, summaries.filter((s) => matches(s, f)).length])) as Record<InventoryFilter, number>;

  const items = summaries.filter((s) => matches(s, filter));
  const byPrice = (dir: 1 | -1) => (a: ListingSummary, b: ListingSummary) => {
    if (a.priceCents === null && b.priceCents === null) return 0;
    if (a.priceCents === null) return 1;
    if (b.priceCents === null) return -1;
    return (a.priceCents - b.priceCents) * dir;
  };
  items.sort(
    sort === 'updated_desc' ? (a, b) => b.updatedAt.localeCompare(a.updatedAt)
    : sort === 'created_desc' ? (a, b) => b.createdAt.localeCompare(a.createdAt)
    : sort === 'price_desc' ? byPrice(-1)
    : sort === 'price_asc' ? byPrice(1)
    : (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  );
  return { items, counts };
}

/** Delete old, completely empty drafts (and their folders). */
export function cleanupEmptyDrafts(db: Db): number {
  const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const candidates = db.select().from(listings)
    .where(and(eq(listings.status, 'draft'), eq(listings.title, ''), eq(listings.description, ''), lt(listings.createdAt, cutoff))).all();
  let removed = 0;
  for (const c of candidates) {
    const hasPhotos = db.select({ id: photos.id }).from(photos).where(eq(photos.listingId, c.id)).get();
    if (hasPhotos) continue;
    db.delete(listings).where(eq(listings.id, c.id)).run();
    fs.rmSync(listingDir(c.id), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

