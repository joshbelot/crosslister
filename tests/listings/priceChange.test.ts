import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fakeAdapter } from '../helpers/fakeAdapter';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { __setAdaptersForTest, allAdapters } from '../../src/server/marketplaces/registry';
import { jobRunner } from '../../src/server/services/jobRunner';
import { marketplaceListings } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';

let t: TestApp;
const real = allAdapters();
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { __setAdaptersForTest(null); await t.cleanup(); });
afterEach(async () => { await jobRunner.idle(); __setAdaptersForTest(real); });

async function setup() {
  __setAdaptersForTest([
    fakeAdapter('mercari', { kind: 'browser', caps: { update: 'assisted' }, update: async () => undefined }),
    ...real.filter((a) => a.id !== 'mercari'),
  ]);
  const l = await seedListing(t.app, { title: 'Keyboard' });
  await req(t.app, 'PATCH', `/api/listings/${l.id}`, { priceCents: 5000 });
  await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/mercari/mark-listed`, {});
  await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/mark-listed`, {});
  return l;
}
const preview = async (id: string, cents: number, clear = false) =>
  (await req(t.app, 'GET', `/api/listings/${id}/price-change/preview?priceCents=${cents}&clearOverrides=${clear ? 1 : 0}`)).json().items as Array<{ marketplaceId: string; newPriceCents: number; canPush: boolean; note: string | null }>;

describe('change price everywhere', () => {
  it('previews which marketplaces the app can change', async () => {
    const l = await setup();
    const items = await preview(l.id, 4000);
    const fake = items.find((i) => i.marketplaceId === 'mercari')!;
    expect(fake).toMatchObject({ newPriceCents: 4000, canPush: true });
    const vinted = items.find((i) => i.marketplaceId === 'vinted')!;
    expect(vinted.canPush).toBe(false);
    expect(vinted.note).toContain('yourself');
  });

  it('creates one price-only update job, saves the price and remembers what each marketplace has', async () => {
    const l = await setup();
    const res = await req(t.app, 'POST', `/api/listings/${l.id}/price-change`, { priceCents: 4000, marketplaceIds: ['mercari', 'vinted'], clearOverrides: false });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.skipped).toEqual([expect.objectContaining({ marketplaceId: 'vinted' })]);
    expect(body.listing.priceCents).toBe(4000);
    const { jobs } = await import('../../src/server/db/schema');
    expect(t.db.select().from(jobs).where(eq(jobs.id, body.jobs[0].id)).get()?.input).toMatchObject({ fields: ['price'] });
    await jobRunner.runOnce(t.db);
    const row = t.db.select().from(marketplaceListings).where(eq(marketplaceListings.listingId, l.id)).all().find((r) => r.marketplaceId === 'mercari')!;
    expect(row.listedPriceCents).toBe(4000);
  });

  it('keeps per-marketplace prices unless asked to replace them', async () => {
    const l = await setup();
    await req(t.app, 'PATCH', `/api/listings/${l.id}/marketplaces/mercari`, { priceOverrideCents: 6000 });
    const kept = (await preview(l.id, 4000, false)).find((i) => i.marketplaceId === 'mercari')!;
    expect(kept.newPriceCents).toBe(6000);
    expect(kept.note).toBeTruthy();
    expect((await preview(l.id, 4000, true)).find((i) => i.marketplaceId === 'mercari')!.newPriceCents).toBe(4000);
    await req(t.app, 'POST', `/api/listings/${l.id}/price-change`, { priceCents: 4000, marketplaceIds: ['mercari'], clearOverrides: true });
    const row = t.db.select().from(marketplaceListings).where(eq(marketplaceListings.listingId, l.id)).all().find((r) => r.marketplaceId === 'mercari')!;
    expect(row.priceOverrideCents).toBeNull();
  });

  it('refuses sold listings', async () => {
    const l = await setup();
    await req(t.app, 'POST', `/api/listings/${l.id}/mark-sold`, { marketplaceId: 'elsewhere', deactivateMarketplaceIds: [] });
    const res = await req(t.app, 'POST', `/api/listings/${l.id}/price-change`, { priceCents: 3000, marketplaceIds: [], clearOverrides: false });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_SOLD');
  });
});
