import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeJpeg, seedListing, uploadPhotos } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { readZip } from '../helpers/zip';
import { toCsvRow } from '../../src/server/services/exporter';
import { MARKETPLACE_ORDER } from '../../src/shared/constants';

let t: TestApp;
let first: { id: string; sku: string };
beforeAll(async () => {
  t = await createTestApp();
  const a = await seedListing(t.app, { title: 'Jeans, "vintage"\nsecond line', tags: ['a', 'b'], colors: ['blue', 'black'] });
  await uploadPhotos(t.app, a.id, [{ name: 'b.jpg', buffer: await makeJpeg(300, 200, '#990000'), type: 'image/jpeg' }]);
  await req(t.app, 'POST', `/api/listings/${a.id}/marketplaces/mercari/mark-listed`, { url: 'https://www.mercari.com/us/item/m1234567/' });
  await seedListing(t.app, { title: 'Second item' });
  first = a;
});
afterAll(async () => { await t.cleanup(); });

describe('json export', () => {
  it('contains every listing with photos and marketplace rows', async () => {
    const res = await req(t.app, 'GET', '/api/export/json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="crosslister-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = res.json();
    expect(body.exportVersion).toBe(1);
    expect(body.app).toBe('crosslister');
    expect(body.listings).toHaveLength(2);
    const l = body.listings.find((x: { id: string }) => x.id === first.id);
    expect(l.photos).toHaveLength(2);
    expect(l.photos[0].file).toMatch(new RegExp(`^listings/${first.id}/original/[a-z0-9]+\\.jpg$`));
    expect(l.marketplaces).toEqual([expect.objectContaining({ marketplaceId: 'mercari', status: 'active', remoteId: 'm1234567' })]);
    expect(l.notes).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('"jobs"');
  });
});

describe('csv export', () => {
  it('has the specified header order and quoting', async () => {
    const res = await req(t.app, 'GET', '/api/export/csv');
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.body;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const header = text.slice(1, text.indexOf('\r\n'));
    const expected = [
      'sku', 'id', 'title', 'description', 'price', 'msrp', 'cost', 'condition', 'category', 'brand', 'model', 'size', 'colors', 'material',
      'quantity', 'tags', 'weight_oz', 'status', 'source', 'sold_at', 'sold_price', 'sold_on', 'created_at', 'updated_at', 'photo_count',
      'primary_photo_file', ...MARKETPLACE_ORDER.flatMap((mp) => [`${mp}_status`, `${mp}_id`, `${mp}_url`]),
    ].join(',');
    expect(header).toBe(expected);
    expect(text).toContain('"Jeans, ""vintage""\nsecond line"');
    expect(text).toContain('65.00');
    expect(text).toContain('blue;black');
    expect(text).toContain('active,m1234567,https://www.mercari.com/us/item/m1234567/');
    expect(text).toContain('Men › Bottoms › Jeans');
  });
  it('toCsvRow quotes only when needed', () => {
    expect(toCsvRow(['a', 'b,c', 'd"e', 'f\ng', ''])).toBe('a,"b,c","d""e","f\ng",');
  });
});

describe('backup', () => {
  it('writes a ZIP with db, export, originals and README (no derived/processed) and applies retention', async () => {
    const { paths, derivedDir } = await import('../../src/server/paths');
    const { photos } = await import('../../src/server/db/schema');
    const res = await req(t.app, 'GET', '/api/export/backup');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const zip = readZip(res.rawPayload);
    const names = [...zip.keys()];
    expect(names).toContain('crosslister.db');
    expect(names).toContain('export.json');
    expect(names).toContain('README.txt');
    expect(zip.get('README.txt')!.toString()).toContain('To restore: quit Crosslister');
    expect(zip.get('crosslister.db')!.subarray(0, 15).toString()).toBe('SQLite format 3');
    const originals = names.filter((n) => n.includes('/original/'));
    expect(originals).toHaveLength(t.db.select().from(photos).all().length);
    expect(names.some((n) => n.includes('/derived/') || n.includes('/processed/'))).toBe(false);
    expect(JSON.parse(zip.get('export.json')!.toString()).listings).toHaveLength(2);
    expect(fs.readdirSync(paths.backupsDir).filter((f) => f.startsWith('tmp-'))).toEqual([]);

    // retention: create more than 10 and make sure only 10 remain
    for (let i = 0; i < 11; i++) await req(t.app, 'GET', '/api/export/backup');
    const list = (await req(t.app, 'GET', '/api/export/backups')).json().items;
    expect(list).toHaveLength(10);
    const dl = await req(t.app, 'GET', `/api/export/backups/${list[0].name}`);
    expect(dl.statusCode).toBe(200);
    expect((await req(t.app, 'GET', '/api/export/backups/..%2Fsecrets.zip')).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('derived regeneration', () => {
  it('recreates a deleted thumb', async () => {
    const { derivedDir } = await import('../../src/server/paths');
    const { regenerateMissingDerived } = await import('../../src/server/services/backup');
    const detail = (await req(t.app, 'GET', `/api/listings/${first.id}`)).json();
    const photoId = detail.photos[0].id;
    const thumb = path.join(derivedDir(first.id), `${photoId}_thumb.jpg`);
    fs.rmSync(thumb);
    expect(await regenerateMissingDerived(t.db)).toBe(1);
    expect(fs.existsSync(thumb)).toBe(true);
    expect(await regenerateMissingDerived(t.db)).toBe(0);
  });
});
