import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import yauzl from 'yauzl';
import { MARKETPLACE_IDS, type MarketplaceId } from '../../shared/constants';
import { listingPatchSchema, type ListingPatch } from '../../shared/schemas';
import type { Db } from '../db/client';
import { importBatches, importItems, listings, marketplaceListings } from '../db/schema';
import { AppError } from '../errors';
import { nanoid12 } from '../ids';
import { paths } from '../paths';
import { events } from '../services/events';
import type { ExportFile, ExportListing, ExportMarketplace } from '../services/exporter';
import { logger } from '../services/logger';
import { findDuplicates } from './duplicates';

const nowIso = () => new Date().toISOString();
const MAX_JSON_BYTES = 200 * 1024 * 1024;

/** Extract only `export.json` and `listings/<id>/original/*` from the ZIP; entries that would leave `dir` are ignored. */
function extractZip(zipPath: string, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new AppError('UNSUPPORTED_BACKUP', 400, 'That file is not a valid Crosslister backup.'));
      zip.on('error', reject);
      zip.on('end', () => resolve());
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        const wanted = name === 'export.json' || /^listings\/[^/]+\/original\/[^/]+$/.test(name);
        const dest = path.resolve(dir, name);
        if (!wanted || name.endsWith('/') || !dest.startsWith(path.resolve(dir) + path.sep)) { zip.readEntry(); return; }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('Could not read the backup.'));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const out = fs.createWriteStream(dest);
          stream.pipe(out);
          out.on('finish', () => zip.readEntry());
          out.on('error', reject);
          stream.on('error', reject);
        });
      });
      zip.readEntry();
    });
  });
}

const PATCH_KEYS = Object.keys(listingPatchSchema.shape) as Array<keyof ListingPatch>;

function toPatch(l: ExportListing): ListingPatch | null {
  const picked: Record<string, unknown> = {};
  for (const k of PATCH_KEYS) if ((l as unknown as Record<string, unknown>)[k] !== undefined) picked[k] = (l as unknown as Record<string, unknown>)[k];
  const r = listingPatchSchema.safeParse(picked);
  return r.success ? r.data : null;
}

/** Stage a Crosslister backup (ZIP from 10 §3 or JSON from 10 §1) as an import batch ready for review (07 §5.4). */
export async function stageBackup(db: Db, file: { path: string; name: string }): Promise<{ batchId: string; count: number }> {
  const batchId = nanoid12();
  const dir = path.join(paths.tmpDir, `restore-${batchId}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    let jsonPath: string;
    if (/\.zip$/i.test(file.name)) {
      await extractZip(file.path, dir);
      jsonPath = path.join(dir, 'export.json');
      if (!fs.existsSync(jsonPath)) throw new AppError('UNSUPPORTED_BACKUP', 400, 'That ZIP does not contain a Crosslister export.');
    } else {
      jsonPath = file.path;
    }
    if (fs.statSync(jsonPath).size > MAX_JSON_BYTES) throw new AppError('UNSUPPORTED_BACKUP', 400, 'That backup file is too large.');
    let data: ExportFile;
    try { data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ExportFile; } catch { throw new AppError('UNSUPPORTED_BACKUP', 400, 'That file is not a valid Crosslister backup.'); }
    if (data?.exportVersion !== 1 || !Array.isArray(data.listings)) {
      throw new AppError('UNSUPPORTED_BACKUP', 400, 'That backup was made by a different version of Crosslister and can’t be restored here.');
    }

    // Keep extracted originals; the batch directory is removed with the batch.
    const batchDir = path.join(paths.importsDir, batchId);
    fs.mkdirSync(batchDir, { recursive: true });
    const now = nowIso();
    db.insert(importBatches).values({ id: batchId, marketplaceId: 'other', method: 'backup', state: 'review', createdAt: now }).run();

    for (const l of data.listings) {
      const mapped = toPatch(l);
      const photoPaths: string[] = [];
      for (const p of [...(l.photos ?? [])].sort((a, b) => a.position - b.position)) {
        const src = path.resolve(dir, p.file);
        if (src.startsWith(path.resolve(dir) + path.sep) && fs.existsSync(src)) {
          const dest = path.join(batchDir, l.id, path.basename(src));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
          photoPaths.push(dest);
        }
      }
      const existing = db.select().from(listings).where(eq(listings.id, l.id)).get()
        ?? db.select().from(listings).where(eq(listings.sku, l.sku)).get();
      const duplicates = mapped ? await findDuplicates(db, { draft: mapped, photoPaths: [], marketplaceId: 'other', remoteId: null }) : [];
      db.insert(importItems).values({
        id: nanoid12(), batchId, marketplaceId: 'other', remoteId: l.id, url: null, title: l.title || l.sku, thumbUrl: null,
        state: mapped ? 'fetched' : 'failed', error: mapped ? null : 'This listing’s details could not be read.',
        raw: l, mapped, photoPaths, duplicates, existingListingId: existing?.id ?? null, createdAt: now,
      }).run();
    }
    events.publish({ type: 'import.updated', batchId });
    return { batchId, count: data.listings.length };
  } catch (err) {
    db.delete(importBatches).where(eq(importBatches.id, batchId)).run();
    fs.rmSync(path.join(paths.importsDir, batchId), { recursive: true, force: true });
    throw err;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Create or update the marketplace rows of a restored/merged listing. Throws ALREADY_LINKED when a different remote ID is linked. */
export function restoreMarketplaceRows(db: Db, listingId: string, rows: ExportMarketplace[], opts: { merge: boolean }): void {
  const now = nowIso();
  for (const m of rows ?? []) {
    if (!MARKETPLACE_IDS.includes(m.marketplaceId as MarketplaceId)) continue;
    const existing = db.select().from(marketplaceListings)
      .where(and(eq(marketplaceListings.listingId, listingId), eq(marketplaceListings.marketplaceId, m.marketplaceId))).get();
    if (existing && opts.merge && existing.remoteId && m.remoteId && existing.remoteId !== m.remoteId) {
      throw new AppError('ALREADY_LINKED', 409, `That item is already linked to a different ${m.marketplaceId} listing.`);
    }
    const values = {
      status: m.status, remoteId: m.remoteId, url: m.url, titleOverride: m.titleOverride, descriptionOverride: m.descriptionOverride,
      priceOverrideCents: m.priceOverrideCents, data: m.data ?? {}, verified: m.verified, listedAt: m.listedAt, endedAt: m.endedAt,
      lastSyncedAt: m.lastSyncedAt, lastError: null, lastErrorCode: null, updatedAt: now,
    };
    if (existing) db.update(marketplaceListings).set(values).where(eq(marketplaceListings.id, existing.id)).run();
    else db.insert(marketplaceListings).values({ id: nanoid12(), listingId, marketplaceId: m.marketplaceId, createdAt: now, ...values }).run();
  }
  logger.info('IMPORT', `Restored ${rows?.length ?? 0} marketplace rows`, { listingId });
}
