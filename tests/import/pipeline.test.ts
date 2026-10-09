import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fakeAdapter } from '../helpers/fakeAdapter';
import { makeJpeg, seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { __setAdaptersForTest } from '../../src/server/marketplaces/registry';
import { jobRunner } from '../../src/server/services/jobRunner';
import { mapToCanonical } from '../../src/server/importers/pipeline';
import type { ImportedListing, MarketplaceImporter } from '../../src/server/importers/types';
import { reverseCondition } from '../../src/server/importers/reverseMapping';

let t: TestApp;
let photo: Buffer;

const remote = (n: number, over: Partial<ImportedListing> = {}): ImportedListing => ({
  remoteId: `r${n}`, url: `https://mercari.example.com/r${n}`, title: `Vintage jacket ${n}`, description: 'Nice jacket', priceCents: 4500,
  conditionText: 'Good', categoryTexts: ['Men', 'Coats & Jackets'], brand: 'Levi’s', size: 'M', colorTexts: ['Blue'],
  photoUrls: ['p1'], status: 'active', quantity: 1, extra: {}, ...over,
});

const importer: MarketplaceImporter = {
  methods: ['shop_page', 'urls'],
  scan: async () => [1, 2, 3].map((n) => ({ remoteId: `r${n}`, url: `https://mercari.example.com/r${n}`, title: `Vintage jacket ${n}`, thumbUrl: null })),
  fetch: async (_ctx, item) => {
    const n = Number((item.remoteId ?? item.url.split('/').pop() ?? 'r1').replace('r', ''));
    if (n === 3) throw new Error('boom');
    return remote(n);
  },
  downloadPhoto: async (_ctx, _url, dest) => { fs.writeFileSync(dest, photo); },
};

beforeAll(async () => {
  t = await createTestApp();
  photo = await makeJpeg(400, 300, '#aa5522', 'top');
  process.env.CROSSLISTER_IMPORT_DELAY_MS = '0';
  __setAdaptersForTest([{ ...fakeAdapter('mercari'), importer }]);
});
afterAll(async () => { __setAdaptersForTest(null); await t.cleanup(); });
afterEach(async () => { await jobRunner.idle(); });

async function scan() {
  const { batch } = (await req(t.app, 'POST', '/api/import/batches', { marketplaceId: 'mercari', method: 'shop_page' })).json();
  await jobRunner.runOnce(t.db);
  return (await req(t.app, 'GET', `/api/import/batches/${batch.id}`)).json();
}
async function fetchAll(b: { batch: { id: string }; items: Array<{ id: string }> }) {
  await req(t.app, 'POST', `/api/import/batches/${b.batch.id}/fetch`, { itemIds: b.items.map((i) => i.id) });
  await jobRunner.runOnce(t.db);
  return (await req(t.app, 'GET', `/api/import/batches/${b.batch.id}`)).json();
}

describe('import pipeline with a fake importer', () => {
  it('rejects methods the importer does not support', async () => {
    const res = await req(t.app, 'POST', '/api/import/batches', { marketplaceId: 'mercari', method: 'api' });
    expect(res.statusCode).toBe(400);
  });

  it('scan → select → fetch stages items and records failures', async () => {
    const b = await scan();
    expect(b.batch.state).toBe('ready');
    expect(b.items).toHaveLength(3);
    const f = await fetchAll(b);
    expect(f.batch.state).toBe('review');
    const byRemote = Object.fromEntries(f.items.map((i: { remoteId: string }) => [i.remoteId, i]));
    expect(byRemote.r1.state).toBe('fetched');
    expect(byRemote.r1.photoCount).toBe(1);
    expect(byRemote.r1.mapped.condition).toBe('good');
    expect(byRemote.r3.state).toBe('failed');
    const photoRes = await req(t.app, 'GET', `/api/import/items/${byRemote.r1.id}/photos/0`);
    expect(photoRes.statusCode).toBe(200);
  });

  it('commits new, merges, skips and detects ALREADY_LINKED', async () => {
    const f = await fetchAll(await scan());
    const [i1, i2] = f.items.filter((i: { state: string }) => i.state === 'fetched');

    const created = (await req(t.app, 'POST', `/api/import/items/${i1.id}/commit`, { action: 'new' })).json();
    expect(created.listing.source).toBe('imported');
    expect(created.listing.photos).toHaveLength(1);
    const ml = created.listing.marketplaces.find((m: { marketplaceId: string }) => m.marketplaceId === 'mercari');
    expect(ml.status).toBe('active');
    expect(ml.remoteId).toBe(i1.remoteId);

    const target = await seedListing(t.app, { title: 'Mine', brand: '' });
    const merged = (await req(t.app, 'POST', `/api/import/items/${i2.id}/commit`, { action: 'merge', targetListingId: target.id })).json();
    expect(merged.listing.id).toBe(target.id);
    expect(merged.listing.title).toBe('Mine'); // existing values win
    expect(merged.listing.brand).toBe('Levi’s'); // empty values are filled

    // a second remote item cannot merge into a listing already linked to a different remote ID
    const other = (await fetchAll(await scan())).items.find((i: { remoteId: string; state: string }) => i.remoteId === 'r1' && i.state === 'fetched');
    const clash = await req(t.app, 'POST', `/api/import/items/${other.id}/commit`, { action: 'merge', targetListingId: target.id });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code ?? clash.json().code).toBe('ALREADY_LINKED');

    const skipped = (await req(t.app, 'POST', `/api/import/items/${other.id}/commit`, { action: 'skip' })).json();
    expect(skipped.item.state).toBe('skipped');
  });

  it('commit-all imports items without duplicates and leaves the rest', async () => {
    const dupeOf = await seedListing(t.app, { title: 'Vintage jacket 2' });
    void dupeOf;
    const f = await fetchAll(await scan());
    const res = (await req(t.app, 'POST', `/api/import/batches/${f.batch.id}/commit-all`, { mode: 'new_without_duplicates' })).json();
    expect(res.imported + res.left).toBeGreaterThan(0);
    const after = (await req(t.app, 'GET', `/api/import/batches/${f.batch.id}`)).json();
    expect(after.items.filter((i: { state: string }) => i.state === 'imported').length).toBe(res.imported);
  });

  it('url method creates a fetch job directly', async () => {
    const res = await req(t.app, 'POST', '/api/import/batches', { marketplaceId: 'mercari', method: 'urls', urls: ['https://mercari.example.com/r2'] });
    expect(res.statusCode).toBe(200);
    await jobRunner.runOnce(t.db);
    const b = (await req(t.app, 'GET', `/api/import/batches/${res.json().batch.id}`)).json();
    expect(b.items[0].state).toBe('fetched');
  });

  it('deletes a batch', async () => {
    const b = await scan();
    expect((await req(t.app, 'DELETE', `/api/import/batches/${b.batch.id}`)).statusCode).toBe(204);
    expect((await req(t.app, 'GET', `/api/import/batches/${b.batch.id}`)).statusCode).toBe(404);
  });
});

describe('mapToCanonical / reverse mapping', () => {
  it('maps an imported listing to canonical fields', () => {
    const p = mapToCanonical('mercari', remote(1, { conditionText: 'New with tags' }));
    expect(p.title).toBe('Vintage jacket 1');
    expect(p.condition).toBe('new_with_tags');
    expect(p.colors).toContain('blue');
    expect(p.notes).toContain('Imported from');
  });
  it('nulls out absurd prices and unknown conditions', () => {
    const p = mapToCanonical('mercari', remote(1, { priceCents: -5, conditionText: 'weird' }));
    expect(p.priceCents).toBeNull();
    expect(reverseCondition('mercari', 'weird')).toBeNull();
  });
});
