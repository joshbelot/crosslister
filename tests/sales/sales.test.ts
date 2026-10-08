import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fakeAdapter, waitFor } from '../helpers/fakeAdapter';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { __setAdaptersForTest, allAdapters } from '../../src/server/marketplaces/registry';
import { jobRunner } from '../../src/server/services/jobRunner';

let t: TestApp;
const real = allAdapters();
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { __setAdaptersForTest(null); await t.cleanup(); });
afterEach(async () => {
  await jobRunner.idle();
  __setAdaptersForTest(real);
  const { jobs } = await import('../../src/server/db/schema');
  const { eq } = await import('drizzle-orm');
  t.db.update(jobs).set({ state: 'CANCELLED' }).where(eq(jobs.state, 'NOT_STARTED')).run(); // leftovers must not leak into the next test
});

const detail = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}`)).json();

async function listedEverywhere() {
  const l = await seedListing(t.app, { priceCents: 5000 });
  for (const mp of ['mercari', 'poshmark', 'depop']) await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/${mp}/mark-listed`, { url: `https://${mp}.example.com/x` });
  return l;
}

describe('mark sold', () => {
  it('sets sold fields, marks the sold marketplace, creates deactivate jobs for the rest', async () => {
    const l = await listedEverywhere();
    expect((await detail(l.id)).status).toBe('listed');
    const res = await req(t.app, 'POST', `/api/listings/${l.id}/mark-sold`, { marketplaceId: 'mercari', deactivateMarketplaceIds: ['poshmark', 'depop', 'ebay'] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.listing.status).toBe('sold');
    expect(body.listing.soldMarketplaceId).toBe('mercari');
    expect(body.listing.soldPriceCents).toBe(5000);
    expect(body.listing.needsAttention).toBe(true);
    expect(body.listing.marketplaces.find((m: { marketplaceId: string }) => m.marketplaceId === 'mercari').status).toBe('sold');
    expect(body.jobs.map((j: { marketplaceId: string; type: string }) => `${j.type}:${j.marketplaceId}`).sort()).toEqual(['deactivate:depop', 'deactivate:poshmark']);
  });

  it('manual deactivate jobs ask the user and complete', async () => {
    const l = await listedEverywhere();
    const { jobs } = (await req(t.app, 'POST', `/api/listings/${l.id}/mark-sold`, { marketplaceId: 'elsewhere', soldPriceCents: 4200, deactivateMarketplaceIds: ['mercari', 'poshmark', 'depop'] })).json();
    expect(jobs).toHaveLength(3);
    const run = jobRunner.runOnce(t.db);
    for (const j of jobs) {
      const waiting = await waitFor(async () => { const x = (await req(t.app, 'GET', `/api/jobs/${j.id}`)).json(); return x.state === 'NEEDS_USER' ? x : null; });
      expect(waiting.needsUser.reason).toBe('manual_delist');
      await req(t.app, 'POST', `/api/jobs/${j.id}/continue`, {});
    }
    await run;
    const d = await detail(l.id);
    expect(d.soldPriceCents).toBe(4200);
    expect(d.marketplaces.every((m: { status: string }) => m.status === 'ended')).toBe(true);
    expect(d.needsAttention).toBe(false);
    expect(d.status).toBe('sold');
  });

  it('undo restores the sold marketplace and clears sold fields', async () => {
    const l = await listedEverywhere();
    await req(t.app, 'POST', `/api/listings/${l.id}/mark-sold`, { marketplaceId: 'poshmark', deactivateMarketplaceIds: [] });
    const undone = (await req(t.app, 'POST', `/api/listings/${l.id}/unmark-sold`)).json();
    expect(undone.soldAt).toBeNull();
    expect(undone.status).toBe('listed');
    expect(undone.marketplaces.find((m: { marketplaceId: string }) => m.marketplaceId === 'poshmark').status).toBe('active');
    expect((await req(t.app, 'POST', `/api/listings/${l.id}/unmark-sold`)).statusCode).toBe(409);
  });
});

describe('deactivate-all and dismiss-sale', () => {
  it('creates one job per active marketplace listing and does not duplicate', async () => {
    __setAdaptersForTest([fakeAdapter('mercari'), fakeAdapter('poshmark'), fakeAdapter('depop'), ...real.filter((a) => !['mercari', 'poshmark', 'depop'].includes(a.id))]);
    const l = await listedEverywhere();
    const first = (await req(t.app, 'POST', `/api/listings/${l.id}/deactivate-all`, {})).json();
    expect(first.jobs).toHaveLength(3);
    const second = (await req(t.app, 'POST', `/api/listings/${l.id}/deactivate-all`, {})).json();
    expect(second.jobs).toHaveLength(0);
    await jobRunner.runOnce(t.db);
    expect((await detail(l.id)).marketplaces.every((m: { status: string }) => m.status === 'ended')).toBe(true);
  });
  it('dismiss-sale clears detection fields', async () => {
    const { listings } = await import('../../src/server/db/schema');
    const { eq } = await import('drizzle-orm');
    const l = await listedEverywhere();
    t.db.update(listings).set({ saleDetectedMarketplaceId: 'mercari', saleDetectedAt: new Date().toISOString() }).where(eq(listings.id, l.id)).run();
    expect((await detail(l.id)).needsAttention).toBe(true);
    const d = (await req(t.app, 'POST', `/api/listings/${l.id}/dismiss-sale`)).json();
    expect(d.saleDetectedMarketplaceId).toBeNull();
    expect(d.needsAttention).toBe(false);
  });
});
