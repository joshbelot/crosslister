import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeJpeg, seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { duplicateLabel, findDuplicates } from '../../src/server/importers/duplicates';

let t: TestApp;
let dir: string;
let samePhoto: string;
let otherPhoto: string;

beforeAll(async () => {
  t = await createTestApp();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-dup-'));
  samePhoto = path.join(dir, 'same.jpg');
  otherPhoto = path.join(dir, 'other.jpg');
  fs.writeFileSync(samePhoto, await makeJpeg());
  fs.writeFileSync(otherPhoto, await makeJpeg(800, 600, '#cc3333', 'top'));
});
afterAll(async () => { fs.rmSync(dir, { recursive: true, force: true }); await t.cleanup(); });

describe('findDuplicates', () => {
  it('returns an exact match when the marketplace ID is already linked', async () => {
    const l = await seedListing(t.app, { title: 'Totally unrelated thing' });
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/mercari/mark-listed`, { url: 'https://www.mercari.com/us/item/m12345678/' });
    const out = await findDuplicates(t.db, { draft: { title: 'x' }, photoPaths: [], marketplaceId: 'mercari', remoteId: 'm12345678' });
    expect(out).toEqual([{ listingId: l.id, score: 1, reasons: ['Same Mercari listing ID'] }]);
  });

  it('scores a similar photo, title, brand, size and price highly', async () => {
    const l = await seedListing(t.app, { title: 'Vintage Levi 501 Jeans dark wash', brand: "Levi's", size: '32', priceCents: 6500 });
    const out = await findDuplicates(t.db, {
      draft: { title: 'Vintage Levi 501 Jeans dark wash', brand: "Levi's", size: '32', priceCents: 6000 }, photoPaths: [samePhoto], marketplaceId: 'poshmark', remoteId: null,
    });
    const hit = out.find((m) => m.listingId === l.id)!;
    expect(hit.score).toBeGreaterThanOrEqual(0.7);
    expect(hit.reasons).toEqual(expect.arrayContaining(['Very similar photo', 'Similar title', 'Same brand', 'Same size', 'Similar price']));
    expect(duplicateLabel(hit.score)).toBe('Likely duplicate');
  });

  it('penalises a different brand and size and ignores unrelated photos', async () => {
    const l = await seedListing(t.app, { title: 'Zebra striped scarf', brand: 'Acme', size: 'S', priceCents: 100_00 });
    const out = await findDuplicates(t.db, {
      draft: { title: 'Zebra striped scarf', brand: 'Other', size: 'XL', priceCents: 100_00 }, photoPaths: [otherPhoto], marketplaceId: 'depop', remoteId: null,
    });
    expect(out.find((m) => m.listingId === l.id)).toBeUndefined();
  });

  it('labels mid scores as possible duplicates', () => {
    expect(duplicateLabel(0.5)).toBe('Possible duplicate');
    expect(duplicateLabel(0.7)).toBe('Likely duplicate');
  });

  it('skips archived listings and returns at most 3, highest first', async () => {
    const archived = await seedListing(t.app, { title: 'Archived parka coat' });
    await req(t.app, 'POST', `/api/listings/${archived.id}/archive`, {});
    for (let i = 0; i < 4; i++) await seedListing(t.app, { title: 'Parka coat winter', brand: 'North', size: 'L' });
    const out = await findDuplicates(t.db, { draft: { title: 'Parka coat winter', brand: 'North', size: 'L' }, photoPaths: [samePhoto], marketplaceId: 'grailed', remoteId: null });
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.map((m) => m.listingId)).not.toContain(archived.id);
    expect([...out].sort((a, b) => b.score - a.score)).toEqual(out);
  });
});
