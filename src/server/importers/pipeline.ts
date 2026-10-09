import fs from 'node:fs';
import path from 'node:path';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { MARKETPLACE_NAMES, type MarketplaceId } from '../../shared/constants';
import type { ListingPatch } from '../../shared/schemas';
import { normalizeSize } from '../../shared/sizes';
import { sizeTypeOf } from '../../shared/taxonomy';
import type { ListingDetail } from '../../shared/types';
import type { Db } from '../db/client';
import { importBatches, importItems, listings, marketplaceListings } from '../db/schema';
import { AppError, notFound } from '../errors';
import { nanoid12 } from '../ids';
import { paths } from '../paths';
import { toAdapterError } from '../marketplaces/adapterError';
import { getAdapter } from '../marketplaces/registry';
import type { MarketplaceAdapter, RemoteStatus } from '../marketplaces/types';
import { events } from '../services/events';
import type { JobContext } from '../services/jobContext';
import { registerJobHandler } from '../services/jobRunner';
import { createJob, getJobRow } from '../services/jobs';
import { recomputeListingStatus } from '../services/listingStatus';
import { createListing, getListing } from '../services/listings';
import { logger } from '../services/logger';
import { addPhotoFromFile, listPhotoRows } from '../services/photos';
import { duplicateLabel, findDuplicates, type DuplicateMatch } from './duplicates';
import { reverseCategory, reverseColors, reverseCondition } from './reverseMapping';
import { createUrlImporter } from './urlImporter';
import type { DiscoveredItem, ImportedListing, MarketplaceImporter } from './types';

export type { DiscoveredItem, ImportedListing, MarketplaceImporter } from './types';

type BatchRow = typeof importBatches.$inferSelect;
type ItemRow = typeof importItems.$inferSelect;
const nowIso = () => new Date().toISOString();
const emit = (batchId: string) => events.publish({ type: 'import.updated', batchId });

export function getImporter(adapter: MarketplaceAdapter): MarketplaceImporter {
  return adapter.importer ?? createUrlImporter(adapter);
}

/** Shared mapping from a marketplace's listing to our canonical fields (07 §2). */
export function mapToCanonical(mp: MarketplaceId, imp: ImportedListing): ListingPatch {
  const categoryId = reverseCategory(imp.categoryTexts, imp.title);
  const notes = [`Imported from ${MARKETPLACE_NAMES[mp]}: ${imp.url}`, ...Object.entries(imp.extra).map(([k, v]) => `${k}: ${v}`)].join('\n');
  const patch: ListingPatch = {
    title: imp.title.trim().slice(0, 200),
    description: imp.description.slice(0, 10_000),
    priceCents: imp.priceCents !== null && imp.priceCents >= 0 && imp.priceCents <= 10_000_000 ? imp.priceCents : null,
    condition: reverseCondition(mp, imp.conditionText, imp.description),
    categoryId,
    brand: imp.brand.trim().slice(0, 100),
    size: normalizeSize(imp.size.slice(0, 40), sizeTypeOf(categoryId)),
    colors: reverseColors(imp.colorTexts),
    quantity: Math.min(999, Math.max(1, Math.round(imp.quantity || 1))),
    notes: notes.slice(0, 10_000),
  };
  return patch;
}

// ---------------------------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------------------------

function markExisting(db: Db, mp: MarketplaceId, remoteId: string | null): string | null {
  if (!remoteId) return null;
  return db.select().from(marketplaceListings).where(and(eq(marketplaceListings.marketplaceId, mp), eq(marketplaceListings.remoteId, remoteId))).get()?.listingId ?? null;
}

export function createBatch(db: Db, input: { marketplaceId: MarketplaceId; method: 'api' | 'shop_page' | 'urls'; urls?: string[] }) {
  const adapter = getAdapter(input.marketplaceId);
  const importer = getImporter(adapter);
  if (!importer.methods.includes(input.method)) {
    throw new AppError('IMPORT_METHOD_UNSUPPORTED', 400, `${adapter.name} can't be imported that way.`);
  }
  const id = nanoid12();
  const now = nowIso();
  if (input.method === 'urls') {
    const urls = [...new Set((input.urls ?? []).map((u) => u.trim()).filter(Boolean))];
    if (urls.length === 0) throw new AppError('VALIDATION', 400, 'Paste at least one listing URL.');
    db.insert(importBatches).values({ id, marketplaceId: input.marketplaceId, method: 'urls', state: 'fetching', createdAt: now }).run();
    for (const url of urls) {
      const remoteId = adapter.parseListingUrl(url)?.remoteId ?? null;
      db.insert(importItems).values({
        id: nanoid12(), batchId: id, marketplaceId: input.marketplaceId, remoteId, url, title: url, state: 'selected',
        existingListingId: markExisting(db, input.marketplaceId, remoteId), createdAt: now,
      }).run();
    }
    const job = createJob(db, { type: 'import_fetch', marketplaceId: input.marketplaceId, listingId: null, input: { batchId: id } });
    emit(id);
    return { batch: getBatchRow(db, id), job };
  }
  db.insert(importBatches).values({ id, marketplaceId: input.marketplaceId, method: input.method, state: 'scanning', createdAt: now }).run();
  const job = createJob(db, { type: 'import_scan', marketplaceId: input.marketplaceId, listingId: null, input: { batchId: id } });
  emit(id);
  return { batch: getBatchRow(db, id), job };
}

export function getBatchRow(db: Db, id: string): BatchRow {
  const row = db.select().from(importBatches).where(eq(importBatches.id, id)).get();
  if (!row) throw notFound('Import batch');
  return row;
}
export function getItemRow(db: Db, id: string): ItemRow {
  const row = db.select().from(importItems).where(eq(importItems.id, id)).get();
  if (!row) throw notFound('Import item');
  return row;
}

function setBatchState(db: Db, id: string, state: string, finished = false): void {
  db.update(importBatches).set({ state, ...(finished ? { finishedAt: nowIso() } : {}) }).where(eq(importBatches.id, id)).run();
  emit(id);
}

function finishIfComplete(db: Db, batchId: string): void {
  const open = db.select({ n: count() }).from(importItems).where(and(eq(importItems.batchId, batchId), inArray(importItems.state, ['discovered', 'selected', 'fetched']))).get()?.n ?? 0;
  if (open === 0) setBatchState(db, batchId, 'done', true);
  else emit(batchId);
}

export function listBatches(db: Db) {
  return db.select().from(importBatches).orderBy(desc(importBatches.createdAt), desc(importBatches.id)).limit(20).all().map((b) => {
    const counts: Record<string, number> = {};
    for (const r of db.select({ state: importItems.state, n: count() }).from(importItems).where(eq(importItems.batchId, b.id)).groupBy(importItems.state).all()) counts[r.state] = r.n;
    return { ...b, counts };
  });
}

export interface Suggestion extends DuplicateMatch { title: string; priceCents: number | null; thumbUrl: string | null; label: string }

export function getBatch(db: Db, id: string) {
  const batch = getBatchRow(db, id);
  const items = db.select().from(importItems).where(eq(importItems.batchId, id)).all().map((it) => {
    const { raw: _raw, ...rest } = it;
    void _raw;
    const suggestions: Suggestion[] = it.duplicates.flatMap((d) => {
      const l = db.select().from(listings).where(eq(listings.id, d.listingId)).get();
      if (!l) return [];
      const photo = listPhotoRows(db, l.id)[0];
      return [{ ...d, title: l.title, priceCents: l.priceCents, thumbUrl: photo ? `/api/photos/${photo.id}/thumb?v=${photo.version}` : null, label: duplicateLabel(d.score) }];
    });
    return { ...rest, suggestions, photoCount: it.photoPaths.length };
  });
  return { batch, items };
}

export function deleteBatch(db: Db, id: string): void {
  getBatchRow(db, id);
  db.delete(importBatches).where(eq(importBatches.id, id)).run();
  fs.rmSync(path.join(paths.importsDir, id), { recursive: true, force: true });
  emit(id);
}

export function stagedPhotoPath(db: Db, itemId: string, n: number): string {
  const item = getItemRow(db, itemId);
  const file = item.photoPaths[n];
  if (!file || !fs.existsSync(file)) throw notFound('Photo');
  return file;
}

export function fetchSelected(db: Db, batchId: string, itemIds: string[]) {
  const batch = getBatchRow(db, batchId);
  const rows = db.select().from(importItems).where(and(eq(importItems.batchId, batchId), inArray(importItems.id, itemIds))).all()
    .filter((i) => ['discovered', 'failed', 'selected'].includes(i.state));
  if (rows.length === 0) throw new AppError('NOTHING_SELECTED', 400, 'Select at least one listing to import.');
  db.update(importItems).set({ state: 'selected', error: null }).where(inArray(importItems.id, rows.map((r) => r.id))).run();
  setBatchState(db, batchId, 'fetching');
  return createJob(db, { type: 'import_fetch', marketplaceId: batch.marketplaceId as MarketplaceId, listingId: null, input: { batchId } });
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

const batchIdOf = (db: Db, jobId: string): string => {
  const id = (getJobRow(db, jobId).input as { batchId?: string } | null)?.batchId;
  if (!id) throw new Error('import job has no batch');
  return id;
};

registerJobHandler('import_scan', async (ctx, job, adapter) => {
  const batchId = batchIdOf(ctx.db, job.id);
  try {
    const importer = getImporter(adapter);
    if (!importer.scan) throw new AppError('IMPORT_METHOD_UNSUPPORTED', 400, `${adapter.name} can't scan a shop page.`);
    const items = await ctx.step('scan', 'Scanning your listings', () => importer.scan!(ctx));
    const seen = new Set<string>();
    let n = 0;
    for (const it of items) {
      if (seen.has(it.remoteId)) continue;
      seen.add(it.remoteId);
      ctx.db.insert(importItems).values({
        id: nanoid12(), batchId, marketplaceId: adapter.id, remoteId: it.remoteId, url: it.url, title: it.title, thumbUrl: it.thumbUrl,
        state: 'discovered', existingListingId: markExisting(ctx.db, adapter.id, it.remoteId), createdAt: nowIso(),
      }).run();
      n++;
    }
    setBatchState(ctx.db, batchId, 'ready');
    return { found: n };
  } catch (err) {
    setBatchState(ctx.db, batchId, 'failed', true);
    throw err;
  }
});

const FATAL = ['CANCELLED', 'BROWSER_CLOSED', 'LOGIN_REQUIRED', 'NOT_CONNECTED', 'NOT_CONFIGURED'];

async function downloadPhotos(ctx: JobContext, importer: MarketplaceImporter, imp: ImportedListing, dir: string): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  for (const [i, url] of imp.photoUrls.slice(0, 24).entries()) {
    const dest = path.join(dir, `${String(i + 1).padStart(2, '0')}.jpg`);
    const raw = `${dest}.raw`;
    try {
      await importer.downloadPhoto(ctx, url, raw);
      await sharp(raw, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toFile(dest);
      out.push(dest);
    } catch (err) {
      logger.warn('IMPORT', `Skipped a photo (${(err as Error).message})`, { jobId: ctx.job.id });
    } finally {
      fs.rmSync(raw, { force: true });
    }
  }
  return out;
}

registerJobHandler('import_fetch', async (ctx, job, adapter) => {
  const batchId = batchIdOf(ctx.db, job.id);
  const importer = getImporter(adapter);
  const items = ctx.db.select().from(importItems).where(and(eq(importItems.batchId, batchId), eq(importItems.state, 'selected'))).all();
  let done = 0;
  for (const [n, item] of items.entries()) {
    ctx.throwIfCancelled();
    try {
      await ctx.step(`item-${n + 1}`, `Reading “${item.title || item.url}”`, async () => {
        const imp = await importer.fetch(ctx, { remoteId: item.remoteId, url: item.url ?? "" });
        const photoPaths = await downloadPhotos(ctx, importer, imp, path.join(paths.importsDir, batchId, item.id));
        const mapped = mapToCanonical(adapter.id, imp);
        const duplicates = await findDuplicates(ctx.db, { draft: mapped, photoPaths, marketplaceId: adapter.id, remoteId: imp.remoteId || item.remoteId });
        ctx.db.update(importItems).set({
          raw: imp, mapped, photoPaths, duplicates, title: imp.title || item.title, remoteId: imp.remoteId || item.remoteId, url: imp.url || item.url,
          existingListingId: markExisting(ctx.db, adapter.id, imp.remoteId || item.remoteId) ?? item.existingListingId, state: 'fetched', error: null,
        }).where(eq(importItems.id, item.id)).run();
        emit(batchId);
      });
      done++;
    } catch (err) {
      const e = toAdapterError(err, adapter.name);
      if (FATAL.includes(e.code) || ctx.signal.aborted) throw err;
      ctx.db.update(importItems).set({ state: 'failed', error: e.userMessage }).where(eq(importItems.id, item.id)).run();
      emit(batchId);
    }
    if (adapter.kind === 'browser' && n < items.length - 1) await ctx.sleep(process.env.CROSSLISTER_IMPORT_DELAY_MS ? Number(process.env.CROSSLISTER_IMPORT_DELAY_MS) : 3000 + Math.floor(Math.random() * 3000));
  }
  setBatchState(ctx.db, batchId, 'review');
  return { fetched: done, failed: items.length - done };
});

// ---------------------------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------------------------

const EMPTY_FILL: Array<[keyof ListingPatch, (v: unknown) => boolean]> = [
  ['title', (v) => v === ''], ['description', (v) => v === ''], ['priceCents', (v) => v === null], ['condition', (v) => v === null],
  ['categoryId', (v) => v === null], ['brand', (v) => v === ''], ['size', (v) => v === ''], ['notes', (v) => v === ''],
  ['colors', (v) => Array.isArray(v) && v.length === 0],
];

function linkMarketplace(db: Db, listingId: string, mp: MarketplaceId, imp: ImportedListing, priceCents: number | null): void {
  const existing = db.select().from(marketplaceListings).where(and(eq(marketplaceListings.listingId, listingId), eq(marketplaceListings.marketplaceId, mp))).get();
  const status = imp.status === 'unknown' ? 'active' : imp.status;
  const now = nowIso();
  const values = {
    status, remoteId: imp.remoteId || null, url: imp.url || null, verified: true, lastSyncedAt: now, listedAt: now, endedAt: status === 'active' ? null : now,
    lastError: null, lastErrorCode: null, updatedAt: now,
  };
  if (existing) db.update(marketplaceListings).set(values).where(eq(marketplaceListings.id, existing.id)).run();
  else db.insert(marketplaceListings).values({ id: nanoid12(), listingId, marketplaceId: mp, createdAt: now, ...values }).run();
  if (status === 'sold') {
    db.update(listings).set({ soldAt: now, soldMarketplaceId: mp, soldPriceCents: priceCents }).where(eq(listings.id, listingId)).run();
  }
}

export async function commitItem(
  db: Db, itemId: string, input: { action: 'new' | 'merge' | 'skip'; targetListingId?: string; overrides?: ListingPatch },
): Promise<{ item: ItemRow; listing: ListingDetail | null }> {
  const item = getItemRow(db, itemId);
  if (item.state !== 'fetched') throw new AppError('ITEM_NOT_READY', 409, 'That item has not been read yet.');
  const mp = item.marketplaceId as MarketplaceId;
  const imp = item.raw as ImportedListing;
  const mapped = (item.mapped ?? {}) as ListingPatch;

  if (input.action === 'skip') {
    db.update(importItems).set({ state: 'skipped' }).where(eq(importItems.id, itemId)).run();
    finishIfComplete(db, item.batchId);
    return { item: getItemRow(db, itemId), listing: null };
  }

  let listingId: string;
  if (input.action === 'new') {
    const created = createListing(db, { ...mapped, ...(input.overrides ?? {}) });
    listingId = created.id;
    db.update(listings).set({ source: 'imported' }).where(eq(listings.id, listingId)).run();
    for (const [i, file] of item.photoPaths.entries()) {
      const r = await addPhotoFromFile(db, listingId, file, `${String(i + 1).padStart(2, '0')}.jpg`);
      if (r.error) logger.warn('IMPORT', r.error, { listingId });
    }
    linkMarketplace(db, listingId, mp, imp, (input.overrides?.priceCents ?? mapped.priceCents) ?? null);
    db.update(importItems).set({ state: 'imported', resultListingId: listingId }).where(eq(importItems.id, itemId)).run();
  } else {
    if (!input.targetListingId) throw new AppError('VALIDATION', 400, 'Choose which item to merge into.');
    const target = db.select().from(listings).where(eq(listings.id, input.targetListingId)).get();
    if (!target) throw notFound('Listing');
    listingId = target.id;
    const linked = db.select().from(marketplaceListings).where(and(eq(marketplaceListings.listingId, listingId), eq(marketplaceListings.marketplaceId, mp))).get();
    if (linked && linked.remoteId && imp.remoteId && linked.remoteId !== imp.remoteId) {
      throw new AppError('ALREADY_LINKED', 409, `That item is already linked to a different ${MARKETPLACE_NAMES[mp]} listing.`);
    }
    const source = { ...mapped, ...(input.overrides ?? {}) } as Record<string, unknown>;
    const fill: Record<string, unknown> = {};
    for (const [key, isEmpty] of EMPTY_FILL) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '' && isEmpty((target as unknown as Record<string, unknown>)[key])) fill[key] = source[key];
    }
    if (Object.keys(fill).length) db.update(listings).set({ ...fill, updatedAt: nowIso() }).where(eq(listings.id, listingId)).run();
    if (listPhotoRows(db, listingId).length === 0) {
      for (const [i, file] of item.photoPaths.entries()) await addPhotoFromFile(db, listingId, file, `${String(i + 1).padStart(2, '0')}.jpg`);
    }
    linkMarketplace(db, listingId, mp, imp, mapped.priceCents ?? null);
    db.update(importItems).set({ state: 'merged', resultListingId: listingId }).where(eq(importItems.id, itemId)).run();
  }
  recomputeListingStatus(db, listingId);
  finishIfComplete(db, item.batchId);
  return { item: getItemRow(db, itemId), listing: getListing(db, listingId) };
}

export async function commitAll(db: Db, batchId: string): Promise<{ imported: number; left: number }> {
  getBatchRow(db, batchId);
  const items = db.select().from(importItems).where(and(eq(importItems.batchId, batchId), eq(importItems.state, 'fetched'))).all();
  let imported = 0;
  for (const it of items) {
    if (it.existingListingId) continue;
    if (it.duplicates.some((d) => d.score >= 0.45)) continue;
    await commitItem(db, it.id, { action: 'new' });
    imported++;
  }
  return { imported, left: items.length - imported };
}

