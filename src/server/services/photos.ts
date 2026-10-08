import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile } from '@fastify/multipart';
import { and, asc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { ACCEPTED_IMAGE_EXTENSIONS, MAX_PHOTOS_PER_LISTING } from '../../shared/constants';
import type { Photo, PhotoCrop } from '../../shared/types';
import type { Db } from '../db/client';
import { listings, photos, type PhotoRow } from '../db/schema';
import { AppError, notFound } from '../errors';
import { nanoid12 } from '../ids';
import { derivedDir, originalDir, paths } from '../paths';
import { events } from './events';
import {
  computeDhash, convertHeicToJpeg, DISPLAY, displayPath, generateDerived, renderUncropped, sourcePath, thumbPath,
} from './imageProcessing';
import { recomputeListingStatus } from './listingStatus';
import { logger } from './logger';
import { rowToPhoto } from './mappers';

const nowIso = () => new Date().toISOString();

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif',
};

function touchListing(db: Db, listingId: string): void {
  db.update(listings).set({ updatedAt: nowIso() }).where(eq(listings.id, listingId)).run();
  recomputeListingStatus(db, listingId);
}

export function listPhotoRows(db: Db, listingId: string): PhotoRow[] {
  return db.select().from(photos).where(eq(photos.listingId, listingId)).orderBy(asc(photos.position)).all();
}

export function getPhotoRow(db: Db, photoId: string): PhotoRow {
  const row = db.select().from(photos).where(eq(photos.id, photoId)).get();
  if (!row) throw notFound('Photo');
  return row;
}

async function measure(file: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(file, { failOn: 'none' }).metadata();
  let width = meta.width ?? 0;
  let height = meta.height ?? 0;
  if ((meta.orientation ?? 1) >= 5) [width, height] = [height, width];
  return { width, height };
}

export interface UploadResult { photos: Photo[]; errors: string[]; notes: string[] }

/** Handles one multipart request: files are processed sequentially (09 §9.1). */
export async function uploadPhotos(db: Db, listingId: string, files: AsyncIterable<MultipartFile>): Promise<UploadResult> {
  if (!db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId)).get()) throw notFound('Listing');
  const errors: string[] = [];
  const notes: string[] = [];
  fs.mkdirSync(paths.tmpDir, { recursive: true });

  for await (const part of files) {
    const name = part.filename || 'photo';
    const ext = path.extname(name).toLowerCase();
    if (!ACCEPTED_IMAGE_EXTENSIONS.includes(ext)) {
      part.file.resume();
      errors.push(`${name}: unsupported file type. Use JPG, PNG, WEBP or HEIC.`);
      continue;
    }
    const existing = listPhotoRows(db, listingId);
    if (existing.length >= MAX_PHOTOS_PER_LISTING) {
      part.file.resume();
      errors.push(`${name}: a listing can have at most ${MAX_PHOTOS_PER_LISTING} photos.`);
      continue;
    }

    const tmp = path.join(paths.tmpDir, nanoid12());
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    part.file.on('data', (chunk: Buffer) => { hash.update(chunk); bytes += chunk.length; });
    try {
      await pipeline(part.file, fs.createWriteStream(tmp));
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    const sha256 = hash.digest('hex');
    if (existing.some((p) => p.sha256 === sha256)) {
      fs.rmSync(tmp, { force: true });
      notes.push(`${name}: already added (skipped).`);
      continue;
    }

    const id = nanoid12();
    const storedFilename = `${id}${ext}`;
    fs.mkdirSync(originalDir(listingId), { recursive: true });
    fs.mkdirSync(derivedDir(listingId), { recursive: true });
    const dest = path.join(originalDir(listingId), storedFilename);
    fs.renameSync(tmp, dest);

    try {
      if (ext === '.heic' || ext === '.heif') {
        await convertHeicToJpeg(dest, path.join(derivedDir(listingId), `${id}_source.jpg`));
      }
      const dims = await measure(sourcePath({ id, listingId, storedFilename }));
      if (!dims.width || !dims.height) throw new Error('unreadable image');
      const draft = { id, listingId, storedFilename, rotation: 0, crop: null };
      const { dhash } = await generateDerived(draft);
      const position = existing.length ? Math.max(...existing.map((p) => p.position)) + 1 : 0;
      db.insert(photos).values({
        id, listingId, position, originalFilename: name, storedFilename,
        mimeType: MIME_BY_EXT[ext] ?? part.mimetype, width: dims.width, height: dims.height, bytes, sha256, dhash,
        rotation: 0, crop: null, version: 1, createdAt: nowIso(),
      }).run();
    } catch (err) {
      removePhotoFiles(listingId, id);
      if (err instanceof AppError) {
        errors.push(`${name}: ${err.userMessage}`);
      } else {
        logger.warn('PHOTOS', `Could not read ${name}: ${(err as Error).message}`, { listingId });
        errors.push(`${name}: this file could not be read as an image.`);
      }
    }
  }

  touchListing(db, listingId);
  return { photos: listPhotoRows(db, listingId).map(rowToPhoto), errors, notes };
}

export function removePhotoFiles(listingId: string, photoId: string): void {
  for (const [dir, prefix] of [[originalDir(listingId), `${photoId}.`], [derivedDir(listingId), `${photoId}_`]] as const) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.startsWith(prefix)) fs.rmSync(path.join(dir, f), { force: true });
  }
}

export function reorderPhotos(db: Db, listingId: string, photoIds: string[]): Photo[] {
  const rows = listPhotoRows(db, listingId);
  const same = rows.length === photoIds.length && new Set(photoIds).size === photoIds.length && rows.every((r) => photoIds.includes(r.id));
  if (!same) throw new AppError('PHOTO_ORDER_MISMATCH', 400, 'The photo order did not match the photos on this listing. Reload and try again.');
  db.transaction(() => {
    photoIds.forEach((id, index) => db.update(photos).set({ position: index }).where(eq(photos.id, id)).run());
  });
  touchListing(db, listingId);
  return listPhotoRows(db, listingId).map(rowToPhoto);
}

export async function editPhoto(
  db: Db, photoId: string, patch: { rotation?: 0 | 90 | 180 | 270; crop?: PhotoCrop | null },
): Promise<Photo> {
  const row = getPhotoRow(db, photoId);
  const rotationChanged = patch.rotation !== undefined && patch.rotation !== row.rotation;
  const rotation = patch.rotation ?? (row.rotation as 0 | 90 | 180 | 270);
  const crop = patch.crop !== undefined ? patch.crop : rotationChanged ? null : row.crop;
  const updated = { ...row, rotation, crop, version: row.version + 1 };
  const { dhash } = await generateDerived(updated);
  db.update(photos).set({ rotation, crop, version: updated.version, dhash }).where(eq(photos.id, photoId)).run();
  touchListing(db, row.listingId);
  return rowToPhoto(getPhotoRow(db, photoId));
}

export function deletePhoto(db: Db, photoId: string): void {
  const row = getPhotoRow(db, photoId);
  db.delete(photos).where(eq(photos.id, photoId)).run();
  removePhotoFiles(row.listingId, photoId);
  db.transaction(() => {
    listPhotoRows(db, row.listingId).forEach((p, i) => {
      if (p.position !== i) db.update(photos).set({ position: i }).where(eq(photos.id, p.id)).run();
    });
  });
  touchListing(db, row.listingId);
}

/** Path of the rotated-but-uncropped 1600px render for the current version (rendered on demand). */
export async function uncroppedPath(row: PhotoRow): Promise<string> {
  const dir = derivedDir(row.listingId);
  const file = path.join(dir, `${row.id}_uncropped_v${row.version}.jpg`);
  if (!fs.existsSync(file)) {
    await renderUncropped(row, file, DISPLAY);
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${row.id}_uncropped_v`) && f !== path.basename(file)) fs.rmSync(path.join(dir, f), { force: true });
    }
  }
  return file;
}

export { displayPath, thumbPath };

/** Copies a listing's photos (originals + rotation/crop/position) onto another listing and regenerates derived files. */
export async function clonePhotos(db: Db, fromId: string, toId: string): Promise<void> {
  for (const p of listPhotoRows(db, fromId)) {
    const id = nanoid12();
    const ext = path.extname(p.storedFilename);
    const storedFilename = `${id}${ext}`;
    fs.mkdirSync(originalDir(toId), { recursive: true });
    fs.mkdirSync(derivedDir(toId), { recursive: true });
    fs.copyFileSync(path.join(originalDir(fromId), p.storedFilename), path.join(originalDir(toId), storedFilename));
    const converted = path.join(derivedDir(fromId), `${p.id}_source.jpg`);
    if (fs.existsSync(converted)) fs.copyFileSync(converted, path.join(derivedDir(toId), `${id}_source.jpg`));
    const copy = { ...p, id, listingId: toId, storedFilename, version: 1, createdAt: nowIso() };
    await generateDerived(copy);
    const dhash = await computeDhash(displayPath(copy));
    db.insert(photos).values({ ...copy, dhash }).run();
  }
}

export function photoExists(db: Db, listingId: string, photoId: string): boolean {
  return Boolean(db.select({ id: photos.id }).from(photos).where(and(eq(photos.id, photoId), eq(photos.listingId, listingId))).get());
}
