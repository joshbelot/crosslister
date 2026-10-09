import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fakeAdapter } from '../helpers/fakeAdapter';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { __setAdaptersForTest } from '../../src/server/marketplaces/registry';
import type { RemoteStatus } from '../../src/server/marketplaces/types';
import { jobs } from '../../src/server/db/schema';
import { jobRunner } from '../../src/server/services/jobRunner';
import { events } from '../../src/server/services/events';

let t: TestApp;
let remote: RemoteStatus = 'active';
const checking = (id: 'mercari' | 'poshmark' | 'depop') => ({
  ...fakeAdapter(id, { caps: { statusCheck: 'api' } }), checkStatus: async () => remote,
});
const noChecks = fakeAdapter('facebook'); // statusCheck: 'none'

beforeAll(async () => {
  t = await createTestApp();
  __setAdaptersForTest([checking('mercari'), checking('poshmark'), noChecks]);
});
afterAll(async () => { __setAdaptersForTest(null); await t.cleanup(); });
afterEach(async () => {
  await jobRunner.idle();
  t.db.update(jobs).set({ state: 'CANCELLED' }).where(eq(jobs.state, 'NOT_STARTED')).run();
  remote = 'active';
});

const detail = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}`)).json();
const listedOn = async (mps: string[]) => {
  const l = await seedListing(t.app);
  for (const mp of mps) await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/${mp}/mark-listed`, { url: `https://${mp}.example.com/x` });
  return l;
};

describe('status checks', () => {
  it('creates jobs only for active targets whose adapter supports checks', async () => {
    const l = await listedOn(['mercari', 'poshmark', 'facebook']);
    const res = (await req(t.app, 'POST', `/api/listings/${l.id}/check-status`)).json();
    expect(res.jobs.map((j: { marketplaceId: string }) => j.marketplaceId).sort()).toEqual(['mercari', 'poshmark']);
    // a second request while checks are pending adds nothing
    expect((await req(t.app, 'POST', `/api/listings/${l.id}/check-status`)).json().jobs).toHaveLength(0);
    await jobRunner.runOnce(t.db);
  });

  it('a sold result flags the sale, marks the marketplace row sold, and never marks the listing sold or deactivates others', async () => {
    const l = await listedOn(['mercari', 'poshmark']);
    remote = 'sold';
    const seen: string[] = [];
    const off = events.subscribe((e) => { if (e.type === 'sale.detected' && e.listingId === l.id) seen.push(e.marketplaceId); });
    await req(t.app, 'POST', `/api/status-checks/run`, { marketplaceIds: ['mercari'] });
    await jobRunner.runOnce(t.db);
    off();
    const d = await detail(l.id);
    expect(d.saleDetectedMarketplaceId).toBe('mercari');
    expect(d.soldAt).toBeNull();
    expect(d.needsAttention).toBe(true);
    expect(d.marketplaces.find((m: { marketplaceId: string }) => m.marketplaceId === 'mercari').status).toBe('sold');
    expect(d.marketplaces.find((m: { marketplaceId: string }) => m.marketplaceId === 'poshmark').status).toBe('active');
    expect(seen).toEqual(['mercari']);
    expect((await req(t.app, 'GET', '/api/jobs?active=1')).json().items.filter((j: { type: string }) => j.type === 'deactivate')).toHaveLength(0);
  });

  it('ended, active and unknown results', async () => {
    const l = await listedOn(['mercari']);
    remote = 'ended';
    await req(t.app, 'POST', `/api/listings/${l.id}/check-status`);
    await jobRunner.runOnce(t.db);
    expect((await detail(l.id)).marketplaces[0].status).toBe('ended');

    const l2 = await listedOn(['poshmark']);
    remote = 'unknown';
    await req(t.app, 'POST', `/api/listings/${l2.id}/check-status`);
    await jobRunner.runOnce(t.db);
    const m = (await detail(l2.id)).marketplaces[0];
    expect(m.status).toBe('active');
  });

  it('dismiss-sale clears the flag but keeps the marketplace row sold', async () => {
    const l = await listedOn(['mercari']);
    remote = 'sold';
    await req(t.app, 'POST', `/api/listings/${l.id}/check-status`);
    await jobRunner.runOnce(t.db);
    const after = (await req(t.app, 'POST', `/api/listings/${l.id}/dismiss-sale`)).json();
    expect(after.saleDetectedMarketplaceId).toBeNull();
    expect(after.marketplaces[0].status).toBe('sold');
  });
});
