import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeExifRotatedJpeg, makeJpeg, makeJpegWithExif, makePng, uploadPhotos } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });

const newListing = async () => (await req(t.app, 'POST', '/api/listings', { title: 'P' })).json().id as string;
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const jpeg = (name: string, buffer: Buffer) => ({ name, buffer, type: 'image/jpeg' });

describe('upload', () => {
  it('stores originals byte-for-byte and derives thumb/display', async () => {
    const { originalDir, derivedDir } = await import('../../src/server/paths');
    const id = await newListing();
    const jpg = await makeJpeg(3000, 2000);
    const png = await makePng(800, 1200);
    const res = await uploadPhotos(t.app, id, [jpeg('a.JPG', jpg), { name: 'b.png', buffer: png, type: 'image/png' }]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors).toEqual([]);
    expect(body.photos).toHaveLength(2);
    const [a, b] = body.photos;
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(a.urls.thumb).toBe(`/api/photos/${a.id}/thumb?v=1`);
    const onDisk = fs.readFileSync(path.join(originalDir(id), `${a.id}.jpg`));
    expect(sha(onDisk)).toBe(sha(jpg));
    expect(a.sha256).toBe(sha(jpg));
    expect(a.width).toBe(3000);
    expect(a.height).toBe(2000);
    const thumb = await sharp(path.join(derivedDir(id), `${a.id}_thumb.jpg`)).metadata();
    const display = await sharp(path.join(derivedDir(id), `${a.id}_display.jpg`)).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(400);
    expect(Math.max(display.width!, display.height!)).toBe(1600);
    expect(a.dhash).toMatch(/^[0-9a-f]{16}$/);
    const served = await req(t.app, 'GET', a.urls.thumb);
    expect(served.statusCode).toBe(200);
    expect(served.headers['cache-control']).toContain('immutable');
    const orig = await req(t.app, 'GET', a.urls.original);
    expect(orig.headers['content-disposition']).toContain('a.JPG');
    expect(sha(orig.rawPayload)).toBe(sha(jpg));
  });

  it('swaps dimensions for EXIF orientation 6', async () => {
    const id = await newListing();
    const res = await uploadPhotos(t.app, id, [jpeg('r.jpg', await makeExifRotatedJpeg())]);
    const p = res.json().photos[0];
    expect([p.width, p.height]).toEqual([200, 400]);
  });

  it('skips duplicates, bad types, and the 25th photo', async () => {
    const id = await newListing();
    const a = await makeJpeg(100, 100, '#111111');
    let res = await uploadPhotos(t.app, id, [jpeg('a.jpg', a)]);
    res = await uploadPhotos(t.app, id, [jpeg('again.jpg', a), { name: 'x.gif', buffer: Buffer.from('GIF89a'), type: 'image/gif' }]);
    const body = res.json();
    expect(body.notes).toEqual(['again.jpg: already added (skipped).']);
    expect(body.errors).toEqual(['x.gif: unsupported file type. Use JPG, PNG, WEBP or HEIC.']);
    expect(body.photos).toHaveLength(1);
    const many = [];
    for (let i = 0; i < 24; i++) many.push(jpeg(`p${i}.jpg`, await makeJpeg(60 + i, 60, '#223344')));
    await uploadPhotos(t.app, id, many.slice(0, 12));
    res = await uploadPhotos(t.app, id, many.slice(12));
    expect(res.json().photos).toHaveLength(24);
    expect(res.json().errors.length).toBeGreaterThan(0);
    expect(res.json().errors[0]).toMatch(/at most 24 photos/);
  });

  it.skipIf(process.platform === 'darwin')('reports HEIC_UNSUPPORTED where HEIC cannot be decoded', async () => {
    const id = await newListing();
    const res = await uploadPhotos(t.app, id, [{ name: 'x.heic', buffer: Buffer.from('not really heic'), type: 'image/heic' }]);
    expect(res.json().photos).toHaveLength(0);
    expect(res.json().errors[0]).toContain('HEIC photos can only be converted on a Mac');
  });
});

describe('edit', () => {
  it('reorders, validates mismatches', async () => {
    const id = await newListing();
    const res = await uploadPhotos(t.app, id, [
      jpeg('1.jpg', await makeJpeg(100, 100, '#101010')), jpeg('2.jpg', await makeJpeg(100, 100, '#202020')), jpeg('3.jpg', await makeJpeg(100, 100, '#303030')),
    ]);
    const ids: string[] = res.json().photos.map((p: { id: string }) => p.id);
    const re = await req(t.app, 'PATCH', `/api/listings/${id}/photos/order`, { photoIds: [ids[2], ids[0], ids[1]] });
    expect(re.statusCode).toBe(200);
    expect(re.json().map((p: { id: string }) => p.id)).toEqual([ids[2], ids[0], ids[1]]);
    const bad = await req(t.app, 'PATCH', `/api/listings/${id}/photos/order`, { photoIds: [ids[0]] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('PHOTO_ORDER_MISMATCH');
    const detail = (await req(t.app, 'GET', `/api/listings/${id}`)).json();
    expect(detail.photos[0].id).toBe(ids[2]);
  });

  it('rotates, crops, resets crop on rotation, and deletes with renumbering', async () => {
    const { derivedDir, originalDir } = await import('../../src/server/paths');
    const id = await newListing();
    const res = await uploadPhotos(t.app, id, [jpeg('1.jpg', await makeJpeg(800, 400, '#101010')), jpeg('2.jpg', await makeJpeg(800, 400, '#505050', 'right'))]);
    const [p1, p2] = res.json().photos;
    const dims = async (pid: string) => { const m = await sharp(path.join(derivedDir(id), `${pid}_display.jpg`)).metadata(); return [m.width, m.height]; };
    expect(await dims(p1.id)).toEqual([800, 400]);

    let r = await req(t.app, 'PATCH', `/api/photos/${p1.id}`, { rotation: 90 });
    expect(r.json().version).toBe(2);
    expect(r.json().rotation).toBe(90);
    expect(await dims(p1.id)).toEqual([400, 800]);

    r = await req(t.app, 'PATCH', `/api/photos/${p1.id}`, { crop: { x: 0, y: 0, width: 1, height: 0.5 } });
    expect(r.json().version).toBe(3);
    expect(await dims(p1.id)).toEqual([400, 400]);
    const un = await req(t.app, 'GET', `/api/photos/${p1.id}/display?uncropped=1`);
    expect(un.statusCode).toBe(200);
    const unMeta = await sharp(un.rawPayload).metadata();
    expect([unMeta.width, unMeta.height]).toEqual([400, 800]);

    r = await req(t.app, 'PATCH', `/api/photos/${p1.id}`, { rotation: 180 });
    expect(r.json().crop).toBeNull();
    expect(await dims(p1.id)).toEqual([800, 400]);

    expect((await req(t.app, 'DELETE', `/api/photos/${p1.id}`)).statusCode).toBe(204);
    expect(fs.readdirSync(originalDir(id)).some((f) => f.startsWith(p1.id))).toBe(false);
    expect(fs.readdirSync(derivedDir(id)).some((f) => f.startsWith(p1.id))).toBe(false);
    const detail = (await req(t.app, 'GET', `/api/listings/${id}`)).json();
    expect(detail.photos.map((p: { id: string; position: number }) => [p.id, p.position])).toEqual([[p2.id, 0]]);
  });
});

describe('marketplace copies and hashing', () => {
  it('limits count, orders files, caps size and strips metadata', async () => {
    const { preparePhotosForMarketplace, computeDhash, hammingDistance } = await import('../../src/server/services/imageProcessing');
    const { photos } = await import('../../src/server/db/schema');
    const { eq } = await import('drizzle-orm');
    const id = await newListing();
    await uploadPhotos(t.app, id, [
      jpeg('1.jpg', await makeJpegWithExif()), jpeg('2.jpg', await makeJpeg(3000, 2000, '#445566')), jpeg('3.jpg', await makeJpeg(500, 500, '#778899')),
    ]);
    const rows = t.db.select().from(photos).where(eq(photos.listingId, id)).all();
    const files = await preparePhotosForMarketplace(id, 'mercari', rows, { maxPhotos: 2, maxLongEdge: 1000, quality: 80 });
    expect(files.map((f) => path.basename(f))).toEqual(['01.jpg', '02.jpg']);
    for (const f of files) {
      const m = await sharp(f).metadata();
      expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(1000);
      expect(m.exif).toBeUndefined();
    }
    const again = await preparePhotosForMarketplace(id, 'mercari', rows, { maxPhotos: 1, maxLongEdge: 1000, quality: 80 });
    expect(again).toHaveLength(1);
    expect(fs.readdirSync(path.dirname(again[0]!))).toEqual(['01.jpg']);

    const left = await makeJpeg(400, 300, '#222222', 'left');
    const right = await makeJpeg(400, 300, '#222222', 'right');
    const f1 = path.join(t.dataDir, 'l.jpg'); const f2 = path.join(t.dataDir, 'r.jpg');
    fs.writeFileSync(f1, left); fs.writeFileSync(f2, right);
    const h1 = await computeDhash(f1);
    expect(await computeDhash(f1)).toBe(h1);
    const h2 = await computeDhash(f2);
    expect(h1).not.toBe(h2);
    expect(hammingDistance(h1, h1)).toBe(0);
    expect(hammingDistance(h1, h2)).toBeGreaterThan(0);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });

  it('duplicating a listing copies photo files', async () => {
    const { listingDir } = await import('../../src/server/paths');
    const id = await newListing();
    await uploadPhotos(t.app, id, [jpeg('1.jpg', await makeJpeg(300, 200, '#abcdef'))]);
    const d = (await req(t.app, 'POST', `/api/listings/${id}/duplicate`)).json();
    expect(d.photos).toHaveLength(1);
    expect(d.photos[0].id).not.toBe((await req(t.app, 'GET', `/api/listings/${id}`)).json().photos[0].id);
    expect(fs.existsSync(path.join(listingDir(d.id), 'original'))).toBe(true);
    expect(fs.readdirSync(path.join(listingDir(d.id), 'derived')).length).toBe(2);
    expect((await req(t.app, 'GET', d.photos[0].urls.thumb)).statusCode).toBe(200);
  });
});
