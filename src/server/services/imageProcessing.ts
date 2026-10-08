import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { MarketplaceId } from '../../shared/constants';
import type { PhotoRow } from '../db/schema';
import { AppError } from '../errors';
import { derivedDir, originalDir, processedDir } from '../paths';

const execFileAsync = promisify(execFile);

export interface RenderOptions { maxLongEdge: number; quality: number }
export interface PhotoSpec { maxPhotos: number; maxLongEdge: number; quality: number }

export const THUMB: RenderOptions = { maxLongEdge: 400, quality: 78 };
export const DISPLAY: RenderOptions = { maxLongEdge: 1600, quality: 85 };

export function originalPath(photo: Pick<PhotoRow, 'listingId' | 'storedFilename'>): string {
  return path.join(originalDir(photo.listingId), photo.storedFilename);
}

/** derived/<id>_source.jpg (HEIC conversions) when it exists, else the original upload. */
export function sourcePath(photo: Pick<PhotoRow, 'id' | 'listingId' | 'storedFilename'>): string {
  const converted = path.join(derivedDir(photo.listingId), `${photo.id}_source.jpg`);
  return fs.existsSync(converted) ? converted : originalPath(photo);
}

type RenderPhoto = Pick<PhotoRow, 'id' | 'listingId' | 'storedFilename' | 'rotation' | 'crop'>;

async function renderInternal(photo: RenderPhoto, out: string, opts: RenderOptions, applyCrop: boolean): Promise<{ width: number; height: number }> {
  const src = sourcePath(photo);
  let img = sharp(src, { failOn: 'none' }).rotate(); // auto-orient from EXIF
  const crop = applyCrop ? photo.crop : null;
  if (photo.rotation !== 0 || crop) {
    // Materialize so the manual rotation / crop happen after EXIF orientation.
    let { data, info } = await img.png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true });
    if (photo.rotation !== 0) {
      ({ data, info } = await sharp(data).rotate(photo.rotation).png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true }));
    }
    img = sharp(data);
    if (crop) {
      const W = info.width;
      const H = info.height;
      const left = Math.min(W - 1, Math.max(0, Math.round(crop.x * W)));
      const top = Math.min(H - 1, Math.max(0, Math.round(crop.y * H)));
      const width = Math.max(1, Math.min(W - left, Math.round(crop.width * W)));
      const height = Math.max(1, Math.min(H - top, Math.round(crop.height * H)));
      img = sharp(await img.extract({ left, top, width, height }).png({ compressionLevel: 1 }).toBuffer());
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // No withMetadata(): sharp drops EXIF/GPS by default (privacy).
  const info = await img
    .resize({ width: opts.maxLongEdge, height: opts.maxLongEdge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .jpeg({ quality: opts.quality, mozjpeg: true })
    .toFile(out);
  return { width: info.width, height: info.height };
}

export async function renderPhoto(photo: RenderPhoto, out: string, opts: RenderOptions): Promise<{ width: number; height: number }> {
  return renderInternal(photo, out, opts, true);
}

/** Rotated but not cropped (used by the crop UI). */
export async function renderUncropped(photo: RenderPhoto, out: string, opts: RenderOptions): Promise<{ width: number; height: number }> {
  return renderInternal(photo, out, opts, false);
}

export const thumbPath = (p: Pick<PhotoRow, 'id' | 'listingId'>) => path.join(derivedDir(p.listingId), `${p.id}_thumb.jpg`);
export const displayPath = (p: Pick<PhotoRow, 'id' | 'listingId'>) => path.join(derivedDir(p.listingId), `${p.id}_display.jpg`);

/** Regenerate thumb + display and return the display's perceptual hash. */
export async function generateDerived(photo: RenderPhoto): Promise<{ dhash: string }> {
  await renderPhoto(photo, thumbPath(photo), THUMB);
  await renderPhoto(photo, displayPath(photo), DISPLAY);
  return { dhash: await computeDhash(displayPath(photo)) };
}

export async function convertHeicToJpeg(input: string, output: string): Promise<void> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (process.platform === 'darwin') {
    try {
      await execFileAsync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', input, '--out', output]);
      return;
    } catch { /* fall through to the error below */ }
  } else {
    try {
      await sharp(input, { failOn: 'none' }).jpeg({ quality: 95 }).toFile(output);
      return;
    } catch { /* fall through */ }
  }
  fs.rmSync(output, { force: true });
  throw new AppError('HEIC_UNSUPPORTED', 415, 'HEIC photos can only be converted on a Mac. Export them as JPEG and try again.');
}

/** 64-bit difference hash as 16 hex chars. */
export async function computeDhash(file: string): Promise<string> {
  const px = await sharp(file, { failOn: 'none' }).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | ((px[y * 9 + x] ?? 0) < (px[y * 9 + x + 1] ?? 0) ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export async function preparePhotosForMarketplace(
  listingId: string, mp: MarketplaceId, photos: PhotoRow[], spec: Partial<PhotoSpec> & { maxPhotos: number },
): Promise<string[]> {
  const dir = processedDir(listingId, mp);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ordered = [...photos].sort((a, b) => a.position - b.position).slice(0, spec.maxPhotos);
  const out: string[] = [];
  for (const [i, p] of ordered.entries()) {
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')}.jpg`);
    await renderPhoto(p, file, { maxLongEdge: spec.maxLongEdge ?? 2048, quality: spec.quality ?? 88 });
    out.push(file);
  }
  return out;
}
