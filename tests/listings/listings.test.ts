import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });

const create = async (body: Record<string, unknown> = {}) => {
  const res = await req(t.app, 'POST', '/api/listings', body);
  expect(res.statusCode).toBe(201);
  return res.json();
};

async function addPhotoRow(listingId: string) {
  const { photos } = await import('../../src/server/db/schema');
  t.db.insert(photos).values({
    id: `p${Math.random().toString(36).slice(2, 10)}`, listingId, position: 0, originalFilename: 'a.jpg', storedFilename: 'a.jpg',
    mimeType: 'image/jpeg', width: 10, height: 10, bytes: 1, sha256: Math.random().toString(), createdAt: new Date().toISOString(),
  }).run();
}
async function addMl(listingId: string, marketplaceId: string, status: string) {
  const { marketplaceListings } = await import('../../src/server/db/schema');
  const now = new Date().toISOString();
  t.db.insert(marketplaceListings).values({ id: `m${Math.random().toString(36).slice(2, 10)}`, listingId, marketplaceId, status, createdAt: now, updatedAt: now }).run();
}
async function recompute(id: string) {
  const { recomputeListingStatus } = await import('../../src/server/services/listingStatus');
  recomputeListingStatus(t.db, id);
  return (await req(t.app, 'GET', `/api/listings/${id}`)).json();
}

describe('create', () => {
  it('applies defaults, allocates SKUs and copies shipping defaults', async () => {
    const s = (await req(t.app, 'GET', '/api/settings')).json();
    s.shippingDefaults.weightOz = 16;
    await req(t.app, 'PUT', '/api/settings', s);
    const a = await create();
    const b = await create({ title: '  Nike Dunk  ', tags: ['A', 'a', 'b'], size: 'xl', categoryId: 'men.tops.polos' });
    expect(a.sku).toBe('CL-00001');
    expect(b.sku).toBe('CL-00002');
    expect(a.status).toBe('draft');
    expect(a.shipping.weightOz).toBe(16);
    expect(a.quantity).toBe(1);
    expect(b.title).toBe('Nike Dunk');
    expect(b.tags).toEqual(['A', 'b']);
    expect(b.size).toBe('XL');
    const recent = (await req(t.app, 'GET', '/api/settings/kv/recent')).json();
    expect(recent.recentCategories).toEqual(['men.tops.polos']);
  });
});

describe('patch validation', () => {
  it('rejects bad input with VALIDATION', async () => {
    const l = await create();
    for (const body of [{ categoryId: 'nope' }, { colors: ['red', 'blue', 'green'] }, { priceCents: -5 }]) {
      const res = await req(t.app, 'PATCH', `/api/listings/${l.id}`, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    }
    expect((await req(t.app, 'PATCH', '/api/listings/nope', { title: 'x' })).statusCode).toBe(404);
  });
});

describe('search, filters, sort', () => {
  it('searches across fields, counts before the status filter, sorts nulls last', async () => {
    const { listings } = await import('../../src/server/db/schema');
    t.db.delete(listings).run();
    const a = await create({ title: 'Blue Jacket', brand: 'Patagonia', priceCents: 5000 });
    const b = await create({ title: 'Red Shirt', brand: 'Nike', priceCents: 2000 });
    const c = await create({ title: 'Green Hat' });
    let r = (await req(t.app, 'GET', '/api/listings?q=patagonia')).json();
    expect(r.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
    r = (await req(t.app, 'GET', `/api/listings?q=${c.sku.toLowerCase()}`)).json();
    expect(r.items).toHaveLength(1);
    r = (await req(t.app, 'GET', '/api/listings?q=blue jacket')).json();
    expect(r.items).toHaveLength(1);
    r = (await req(t.app, 'GET', '/api/listings?sort=price_asc')).json();
    expect(r.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id, c.id]);
    r = (await req(t.app, 'GET', '/api/listings?sort=price_desc')).json();
    expect(r.items.map((i: { id: string }) => i.id)).toEqual([a.id, b.id, c.id]);
    r = (await req(t.app, 'GET', '/api/listings?sort=title_asc')).json();
    expect(r.items.map((i: { title: string }) => i.title)).toEqual(['Blue Jacket', 'Green Hat', 'Red Shirt']);
    await req(t.app, 'POST', `/api/listings/${a.id}/archive`);
    r = (await req(t.app, 'GET', '/api/listings?filter=archived')).json();
    expect(r.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
    expect(r.counts.all).toBe(2);
    expect(r.counts.archived).toBe(1);
    expect(r.counts.draft).toBe(2);
    r = (await req(t.app, 'GET', '/api/listings?filter=sold&q=hat')).json();
    expect(r.items).toHaveLength(0);
    expect(r.counts.all).toBe(1);
  });
});

describe('status recompute', () => {
  it('moves through draft → ready → partially_listed → listed → sold → archived', async () => {
    const l = await create({ title: 'T', priceCents: 1000, condition: 'good', categoryId: 'men.tops.polos' });
    expect(l.status).toBe('draft'); // no photo yet
    await addPhotoRow(l.id);
    expect((await recompute(l.id)).status).toBe('ready');
    await addMl(l.id, 'mercari', 'active');
    await addMl(l.id, 'poshmark', 'not_listed');
    expect((await recompute(l.id)).status).toBe('partially_listed');
    const { marketplaceListings } = await import('../../src/server/db/schema');
    t.db.update(marketplaceListings).set({ status: 'active' }).where(eq(marketplaceListings.marketplaceId, 'poshmark')).run();
    expect((await recompute(l.id)).status).toBe('listed');
    const { listings } = await import('../../src/server/db/schema');
    t.db.update(listings).set({ soldAt: new Date().toISOString() }).where(eq(listings.id, l.id)).run();
    const sold = await recompute(l.id);
    expect(sold.status).toBe('sold');
    expect(sold.needsAttention).toBe(true); // sold but still active somewhere
    expect((await (await req(t.app, 'POST', `/api/listings/${l.id}/archive`)).json()).status).toBe('archived');
    expect((await (await req(t.app, 'POST', `/api/listings/${l.id}/unarchive`)).json()).status).toBe('sold');
  });
});

describe('needsAttention', () => {
  it('flags error targets, sale detection and failed/needs-user jobs', async () => {
    const { listings, jobs } = await import('../../src/server/db/schema');
    const l = await create({ title: 'N' });
    expect(l.needsAttention).toBe(false);
    await addMl(l.id, 'depop', 'error');
    expect((await recompute(l.id)).needsAttention).toBe(true);

    const l2 = await create({ title: 'N2' });
    t.db.update(listings).set({ saleDetectedMarketplaceId: 'ebay' }).where(eq(listings.id, l2.id)).run();
    expect((await recompute(l2.id)).needsAttention).toBe(true);

    const l3 = await create({ title: 'N3' });
    const now = new Date().toISOString();
    t.db.insert(jobs).values({ id: 'j-needs', type: 'publish', marketplaceId: 'mercari', listingId: l3.id, state: 'NEEDS_USER', createdAt: now }).run();
    expect((await recompute(l3.id)).needsAttention).toBe(true);
    t.db.update(jobs).set({ state: 'FAILED' }).where(eq(jobs.id, 'j-needs')).run();
    expect((await recompute(l3.id)).needsAttention).toBe(true);
    t.db.update(jobs).set({ state: 'SUCCESS' }).where(eq(jobs.id, 'j-needs')).run();
    expect((await recompute(l3.id)).needsAttention).toBe(false);
  });
});

describe('duplicate, delete, cleanup', () => {
  it('duplicates fields with a new SKU and not_listed targets', async () => {
    const l = await create({ title: 'Orig', brand: 'Acme', priceCents: 1234, categoryId: 'men.tops.polos' });
    await addMl(l.id, 'ebay', 'active');
    const res = await req(t.app, 'POST', `/api/listings/${l.id}/duplicate`);
    expect(res.statusCode).toBe(201);
    const d = res.json();
    expect(d.id).not.toBe(l.id);
    expect(d.sku).not.toBe(l.sku);
    expect(d.title).toBe('Orig');
    expect(d.priceCents).toBe(1234);
    expect(d.marketplaces.map((m: { marketplaceId: string; status: string }) => [m.marketplaceId, m.status])).toEqual([['ebay', 'not_listed']]);
  });
  it('refuses to delete with an active target unless forced', async () => {
    const { listingDir } = await import('../../src/server/paths');
    const l = await create({ title: 'Del' });
    await addMl(l.id, 'ebay', 'active');
    fs.mkdirSync(listingDir(l.id), { recursive: true });
    const res = await req(t.app, 'DELETE', `/api/listings/${l.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LISTING_HAS_ACTIVE');
    expect((await req(t.app, 'DELETE', `/api/listings/${l.id}?force=1`)).statusCode).toBe(204);
    expect(fs.existsSync(listingDir(l.id))).toBe(false);
    expect((await req(t.app, 'GET', `/api/listings/${l.id}`)).statusCode).toBe(404);
  });
  it('only removes old, empty drafts', async () => {
    const { listings } = await import('../../src/server/db/schema');
    const { cleanupEmptyDrafts } = await import('../../src/server/services/listings');
    t.db.delete(listings).run();
    const fresh = await create();
    const old = await create();
    const oldTitled = await create({ title: 'Keep me' });
    const oldWithPhoto = await create();
    await addPhotoRow(oldWithPhoto.id);
    const past = new Date(Date.now() - 48 * 3_600_000).toISOString();
    for (const x of [old, oldTitled, oldWithPhoto]) t.db.update(listings).set({ createdAt: past }).where(eq(listings.id, x.id)).run();
    expect(cleanupEmptyDrafts(t.db)).toBe(1);
    const ids = t.db.select().from(listings).all().map((r) => r.id).sort();
    expect(ids).toEqual([fresh.id, oldTitled.id, oldWithPhoto.id].sort());
  });
});
