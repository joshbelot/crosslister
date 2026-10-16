import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { __setAdaptersForTest, allAdapters } from '../../src/server/marketplaces/registry';
import { manualAdapter } from '../../src/server/marketplaces/manual';
import { jobRunner } from '../../src/server/services/jobRunner';
import { listings, marketplaceListings, sales } from '../../src/server/db/schema';
import { backfillSales } from '../../src/server/services/salesLedger';

let t: TestApp;
const real = allAdapters().map((a) => (a.kind === 'browser' ? manualAdapter(a.id, a.name, a.urls) : a));
beforeAll(async () => { t = await createTestApp(); __setAdaptersForTest(real); });
afterAll(async () => { __setAdaptersForTest(null); await t.cleanup(); });
afterEach(async () => { await jobRunner.idle(); __setAdaptersForTest(real); });

const api = async (path: string) => (await req(t.app, 'GET', path)).json();
async function listed(extra: Record<string, unknown> = {}) {
  const l = await seedListing(t.app, { priceCents: 5000, ...extra });
  await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/mercari/mark-listed`, { url: 'https://mercari.example.com/x' });
  return l;
}

describe('sales ledger', () => {
  it('records a sale with fees, costs and net', async () => {
    const l = await listed({ costCents: 1000, title: 'Ledger one' });
    await req(t.app, 'POST', `/api/listings/${l.id}/mark-sold`, {
      marketplaceId: 'mercari', soldPriceCents: 4000, marketplaceFeesCents: 520, shippingCostCents: 800, deactivateMarketplaceIds: [],
    });
    const res = await api('/api/sales?q=Ledger%20one');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ netCents: 1680, source: 'manual', marketplaceId: 'mercari', salePriceCents: 4000, itemCostCents: 1000 });
    expect(res.totals).toMatchObject({ count: 1, revenueCents: 4000, feesCents: 520, netCents: 1680 });
    expect((await api(`/api/listings/${l.id}`)).sale).toMatchObject({ netCents: 1680 });
  });

  it('defaults the sale price to what the marketplace has listed', async () => {
    const l = await listed({ title: 'Ledger two' });
    t.db.update(marketplaceListings).set({ listedPriceCents: 4500 }).where(eq(marketplaceListings.listingId, l.id)).run();
    await req(t.app, 'POST', `/api/listings/${l.id}/mark-sold`, { marketplaceId: 'mercari', deactivateMarketplaceIds: [] });
    expect((await api('/api/sales?q=Ledger%20two')).items[0].salePriceCents).toBe(4500);
  });

  it('removes the sale row when the sale is undone', async () => {
    const l = await listed({ title: 'Ledger three' });
    await req(t.app, 'POST', `/api/listings/${l.id}/mark-sold`, { marketplaceId: 'mercari', soldPriceCents: 3000, deactivateMarketplaceIds: [] });
    expect((await api('/api/sales?q=Ledger%20three')).items).toHaveLength(1);
    await req(t.app, 'POST', `/api/listings/${l.id}/unmark-sold`);
    expect((await api('/api/sales?q=Ledger%20three')).items).toHaveLength(0);
  });

  it('backfills sold listings that have no sale row, once', async () => {
    const l = await seedListing(t.app, { title: 'Ledger four' });
    t.db.update(listings).set({ soldAt: '2026-09-01T12:00:00.000Z', soldPriceCents: 2500, soldMarketplaceId: 'poshmark' }).where(eq(listings.id, l.id)).run();
    backfillSales(t.db);
    backfillSales(t.db);
    const rows = t.db.select().from(sales).where(eq(sales.listingId, l.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ salePriceCents: 2500, marketplaceId: 'poshmark', source: 'manual' });
  });

  it('filters by date, platform and text', async () => {
    const a = await listed({ title: 'Filter alpha' });
    const b = await seedListing(t.app, { priceCents: 3000, title: 'Filter beta' });
    await req(t.app, 'POST', `/api/listings/${a.id}/mark-sold`, { marketplaceId: 'mercari', soldPriceCents: 4000, soldAt: '2026-01-10T12:00:00.000Z', deactivateMarketplaceIds: [] });
    await req(t.app, 'POST', `/api/listings/${b.id}/mark-sold`, { marketplaceId: 'elsewhere', soldPriceCents: 3000, soldAt: '2026-02-10T12:00:00.000Z', deactivateMarketplaceIds: [] });
    const titles = async (qs: string) => (await api(`/api/sales?q=Filter&${qs}`)).items.map((i: { title: string }) => i.title);
    expect(await titles('')).toEqual(['Filter beta', 'Filter alpha']);
    expect(await titles('from=2026-02-01')).toEqual(['Filter beta']);
    expect(await titles('to=2026-01-31')).toEqual(['Filter alpha']);
    expect(await titles('marketplaceId=mercari')).toEqual(['Filter alpha']);
    expect((await api('/api/sales?q=beta')).items).toHaveLength(1);
  });

  it('edits a sale and recomputes the net', async () => {
    const l = await listed({ title: 'Ledger six' });
    await req(t.app, 'POST', `/api/listings/${l.id}/mark-sold`, { marketplaceId: 'mercari', soldPriceCents: 4000, deactivateMarketplaceIds: [] });
    const id = (await api('/api/sales?q=Ledger%20six')).items[0].id;
    const res = await req(t.app, 'PATCH', `/api/sales/${id}`, { marketplaceFeesCents: 600 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ marketplaceFeesCents: 600, netCents: 3400 });
    expect((await req(t.app, 'PATCH', '/api/sales/nope', { buyer: 'x' })).statusCode).toBe(404);
  });

  it('exports CSV with a header and one line per sale', async () => {
    const res = await req(t.app, 'GET', '/api/sales/export.csv?q=Ledger%20six');
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe('Sold at,Title,SKU,Platform,Sale price,Shipping charged,Fees,Shipping cost,Other costs,Item cost,Net,Buyer,Order link,Notes,Source');
    expect(lines).toHaveLength(2);
  });

  it('keeps the sale row when the listing is deleted', async () => {
    const l = await listed({ title: 'Ledger eight' });
    await req(t.app, 'POST', `/api/listings/${l.id}/mark-sold`, { marketplaceId: 'mercari', soldPriceCents: 4000, deactivateMarketplaceIds: [] });
    expect((await req(t.app, 'DELETE', `/api/listings/${l.id}?force=1`)).statusCode).toBe(204);
    const items = (await api('/api/sales?q=Ledger%20eight')).items;
    expect(items).toHaveLength(1);
    expect(items[0].listingId).toBeNull();
  });
});
