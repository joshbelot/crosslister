import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { buildEffectiveListing, measurementsLine } from '../../src/server/services/effectiveListing';
import { validateForMarketplace } from '../../src/server/services/validation';
import { manualAdapter } from '../../src/server/marketplaces/manual';
import { DEFAULT_SETTINGS } from '../../src/server/services/settings';
import { rowToListing, rowToMarketplaceListing } from '../../src/server/services/mappers';
import { listings, marketplaceListings, photos } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.cleanup(); });

const issuesFor = (report: { marketplaces: Array<{ marketplaceId: string; issues: Array<{ field: string; severity: string; message: string }> }> }, mp: string) =>
  report.marketplaces.find((m) => m.marketplaceId === mp)!.issues;

describe('canonical rules', () => {
  it('flags every missing field', async () => {
    const l = (await req(t.app, 'POST', '/api/listings', {})).json();
    const rep = (await req(t.app, 'GET', `/api/listings/${l.id}/validation?marketplaceIds=mercari`)).json();
    const msgs = rep.canonical.map((i: { message: string }) => i.message);
    expect(msgs).toEqual(expect.arrayContaining([
      'Add a title.', 'Add at least one photo.', 'Add a price.', 'Choose a condition.', 'Choose a category.',
      'Add a description — buyers rarely purchase without one.',
    ]));
    const m = rep.marketplaces[0];
    expect(m.ready).toBe(false);
    expect(m.issues.filter((i: { severity: string }) => i.severity === 'error').length).toBeGreaterThanOrEqual(5);
  });
  it('warns about quantity > 1', async () => {
    const l = await seedListing(t.app, { quantity: 3 });
    const rep = (await req(t.app, 'GET', `/api/listings/${l.id}/validation?marketplaceIds=mercari`)).json();
    expect(rep.canonical.some((i: { field: string }) => i.field === 'quantity')).toBe(true);
    expect(rep.marketplaces[0].ready).toBe(true);
  });
});

describe('marketplace rules', () => {
  it('reports per-marketplace readiness with previews', async () => {
    const l = await seedListing(t.app, { title: 'x'.repeat(10) + ' ' + 'word '.repeat(30) });
    const rep = (await req(t.app, 'GET', `/api/listings/${l.id}/validation?marketplaceIds=vinted,mercari`)).json();
    expect(rep.marketplaces.map((m: { marketplaceId: string }) => m.marketplaceId)).toEqual(['mercari', 'vinted']);
    const issues = issuesFor(rep, 'mercari');
    const trunc = issues.find((i) => i.field === 'title');
    expect(trunc?.severity).toBe('warning');
    expect(trunc?.message).toMatch(/^Title will be shortened to 100 characters on Mercari: "/);
    expect(rep.marketplaces[0].preview.title.length).toBeLessThanOrEqual(100);
    expect(rep.marketplaces[0].ready).toBe(true);
    expect(rep.marketplaces[0].preview.photoCount).toBe(1);
  });
  it('checks description length, price limits, and requirements', async () => {
    const l = await seedListing(t.app, { description: 'd'.repeat(2500) });
    const rep = (await req(t.app, 'GET', `/api/listings/${l.id}/validation?marketplaceIds=vinted,mercari`)).json();
    expect(issuesFor(rep, 'vinted').find((i) => i.field === 'description')?.message)
      .toMatch(/^Description is \d+ characters; Vinted allows 2000\. Shorten it or write a Vinted-specific description\.$/);
    expect(issuesFor(rep, 'mercari').some((i) => i.field === 'description')).toBe(false);
  });
  it('unit rules: min/max price, requires, photo count, data errors', () => {
    const adapter = manualAdapter('other', 'Other', { home: 'about:blank', sell: 'about:blank' }, {
      minPriceCents: 500, maxPriceCents: 10000, maxPhotos: 1,
      requires: ['title', 'price', 'brand', 'size', 'shippingWeight', 'msrp', 'colors'],
    });
    const now = new Date().toISOString();
    const row = {
      id: 'l1', sku: 'CL-1', title: 'T', description: 'D', priceCents: 200, msrpCents: null, costCents: null, currency: 'USD',
      condition: 'good', conditionNotes: '', categoryId: 'men.tops.polos', brand: '', model: '', size: '', colors: [], material: '',
      quantity: 1, measurements: {}, tags: [], shipping: { weightOz: null, lengthIn: null, widthIn: null, heightIn: null, whoPays: 'buyer' },
      notes: 'private', status: 'draft', source: 'created', soldAt: null, soldPriceCents: null, soldMarketplaceId: null,
      saleDetectedMarketplaceId: null, saleDetectedAt: null, archivedAt: null, createdAt: now, updatedAt: now,
    };
    const ml = rowToMarketplaceListing({
      id: 'm', listingId: 'l1', marketplaceId: 'other', status: 'not_listed', remoteId: null, url: null, titleOverride: null,
      descriptionOverride: null, priceOverrideCents: null, data: {}, verified: true, lastError: null, lastErrorCode: null,
      listedAt: null, endedAt: null, lastSyncedAt: null, createdAt: now, updatedAt: now,
    });
    const eff = buildEffectiveListing(rowToListing(row), [], ml, adapter, DEFAULT_SETTINGS);
    eff.dataErrors = ['bad value'];
    const msgs = validateForMarketplace(eff, adapter, 'T', 3).map((i) => i.message);
    expect(msgs).toEqual(expect.arrayContaining([
      'Other requires a price of at least $5.00.', 'Other requires a brand.', 'Other requires a size.',
      'Other needs the package weight (Shipping → Weight).', 'Other requires the original retail price (MSRP).',
      'Other requires a color.', 'Only the first 1 photos will be uploaded to Other.', 'Other settings: bad value',
    ]));
    eff.priceCents = 20000;
    expect(validateForMarketplace(eff, adapter, 'T').map((i) => i.message)).toContain('Other allows a price of at most $100.00.');
  });
});

describe('effective listing', () => {
  it('applies price adjust, overrides, description composition and keeps private fields out', async () => {
    const s = (await req(t.app, 'GET', '/api/settings')).json();
    s.marketplaces.mercari.priceAdjustPercent = 10;
    s.descriptionFooter = 'Ships fast!';
    await req(t.app, 'PUT', '/api/settings', s);
    const l = await seedListing(t.app, {
      description: 'Nice jeans with a small stain.', conditionNotes: 'Small stain', notes: 'bought at flea market', costCents: 100,
      measurements: { chestIn: 22, lengthIn: 28.5 },
    });
    await req(t.app, 'PUT', `/api/listings/${l.id}/marketplaces`, { marketplaceIds: ['mercari', 'poshmark'] });
    const p = (await req(t.app, 'GET', `/api/listings/${l.id}/marketplaces/mercari/preview`)).json();
    expect(p.priceCents).toBe(7200);
    expect(p.description).toBe('Nice jeans with a small stain.\n\nMeasurements: Chest 22" · Length 28.5"\n\nShips fast!');
    expect(p.description).not.toContain('flea');
    expect(p.mapping).toEqual([{ label: 'Condition', value: 'Good' }, { label: 'Category', value: 'Men › Bottoms › Jeans' }]);

    await req(t.app, 'PATCH', `/api/listings/${l.id}`, { conditionNotes: 'Faded knees' });
    await req(t.app, 'PATCH', `/api/listings/${l.id}/marketplaces/mercari`, { titleOverride: 'Custom title', priceOverrideCents: 5000, descriptionOverride: 'Override desc' });
    const p2 = (await req(t.app, 'GET', `/api/listings/${l.id}/marketplaces/mercari/preview`)).json();
    expect(p2.title).toBe('Custom title');
    expect(p2.priceCents).toBe(5000);
    expect(p2.description).toBe('Override desc\n\nMeasurements: Chest 22" · Length 28.5"\n\nFlaws/notes: Faded knees\n\nShips fast!');
    const p3 = (await req(t.app, 'GET', `/api/listings/${l.id}/marketplaces/poshmark/preview`)).json();
    expect(p3.priceCents).toBe(6500);
    expect(measurementsLine({})).toBe('');
  });
});

describe('targets', () => {
  it('adds/removes targets, normalizes overrides, guards active ones', async () => {
    const l = await seedListing(t.app);
    let d = (await req(t.app, 'PUT', `/api/listings/${l.id}/marketplaces`, { marketplaceIds: ['poshmark', 'mercari'] })).json();
    expect(d.marketplaces.map((m: { marketplaceId: string }) => m.marketplaceId)).toEqual(['mercari', 'poshmark']);
    expect((await req(t.app, 'GET', '/api/settings/kv/recent')).json().lastMarketplaces).toEqual(['poshmark', 'mercari']);

    const patched = (await req(t.app, 'PATCH', `/api/listings/${l.id}/marketplaces/mercari`, { titleOverride: '', data: { x: 1 } })).json();
    expect(patched.titleOverride).toBeNull();
    expect(patched.data).toEqual({ x: 1 });

    const ml = t.db.select().from(marketplaceListings).where(eq(marketplaceListings.marketplaceId, 'mercari')).all().find((r) => r.listingId === l.id)!;
    t.db.update(marketplaceListings).set({ status: 'active' }).where(eq(marketplaceListings.id, ml.id)).run();
    d = (await req(t.app, 'PUT', `/api/listings/${l.id}/marketplaces`, { marketplaceIds: [] })).json();
    expect(d.marketplaces.map((m: { marketplaceId: string }) => m.marketplaceId)).toEqual(['mercari']); // active stays, poshmark removed
    const del = await req(t.app, 'DELETE', `/api/listings/${l.id}/marketplaces/mercari`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('TARGET_ACTIVE');
    t.db.update(marketplaceListings).set({ status: 'ended' }).where(eq(marketplaceListings.id, ml.id)).run();
    expect((await req(t.app, 'DELETE', `/api/listings/${l.id}/marketplaces/mercari`)).statusCode).toBe(204);
    expect((await req(t.app, 'GET', `/api/listings/${l.id}/marketplaces/zzz/preview`)).statusCode).toBe(400);
  });
  it('lists marketplaces and serves category maps', async () => {
    const list = (await req(t.app, 'GET', '/api/marketplaces')).json();
    expect(list.map((m: { id: string }) => m.id)).toEqual(['mercari', 'poshmark', 'depop', 'facebook', 'ebay', 'grailed', 'vinted', 'offerup', 'etsy', 'other']);
    expect(list[0].prefs.dailyLimit).toBe(25);
    const put = await req(t.app, 'PUT', '/api/settings/category-map/mercari', { map: { 'men.tops': 'Men > Tops', 'x': '  ' } });
    expect(put.json().map).toEqual({ 'men.tops': 'Men > Tops' });
    expect((await req(t.app, 'GET', '/api/settings/category-map/mercari')).json()).toEqual({ map: { 'men.tops': 'Men > Tops' }, builtIn: {} });
  });
  it('marks listed (parsing URLs) and ended', async () => {
    const l = await seedListing(t.app);
    const ml = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/mercari/mark-listed`, { url: 'https://www.mercari.com/us/item/m123/' })).json();
    expect(ml.status).toBe('active');
    expect(ml.verified).toBe(true);
    expect(ml.remoteId).toBe('m123');
    const bare = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/poshmark/mark-listed`, {})).json();
    expect(bare.status).toBe('active');
    expect(bare.verified).toBe(false);
    expect((await req(t.app, 'GET', `/api/listings/${l.id}`)).json().status).toBe('listed');
    const ended = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/poshmark/mark-ended`)).json();
    expect(ended.status).toBe('ended');
    expect(ended.endedAt).toBeTruthy();
    void listings; void photos;
  });
});
