import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { fakeAdapter } from '../helpers/fakeAdapter';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { __setAdaptersForTest } from '../../src/server/marketplaces/registry';
import type { RemoteStatus } from '../../src/server/marketplaces/types';
import { jobs, marketplaceListings, sales } from '../../src/server/db/schema';
import { jobRunner } from '../../src/server/services/jobRunner';
import { setKv } from '../../src/server/services/settings';
import { pollBrowserMarketplaces } from '../../src/server/services/statusChecks';
import { notifyUser } from '../../src/server/services/notify';

vi.mock('../../src/server/services/notify', () => ({ notifyUser: vi.fn() }));

let t: TestApp;
let script: Array<RemoteStatus | Error> = [];
const watching = (id: 'mercari' | 'poshmark') => ({
  ...fakeAdapter(id, { kind: 'browser', caps: { statusCheck: 'browser' } }),
  checkStatus: async (): Promise<RemoteStatus> => {
    const next = script.length > 1 ? script.shift()! : script[0] ?? 'active';
    if (next instanceof Error) throw next;
    return next;
  },
});

beforeAll(async () => { t = await createTestApp(); __setAdaptersForTest([watching('mercari'), watching('poshmark')]); });
afterAll(async () => { __setAdaptersForTest(null); await t.cleanup(); });
beforeEach(async () => { await setSettings({ autoDelist: true, polling: true }); setKv(t.db, 'browser_last_poll', 0); t.db.delete(jobs).run(); t.db.delete(marketplaceListings).run(); vi.mocked(notifyUser).mockClear(); });
afterEach(async () => {
  await jobRunner.idle();
  t.db.update(jobs).set({ state: 'CANCELLED' }).where(eq(jobs.state, 'NOT_STARTED')).run();
  script = [];
});

async function setSettings(o: { autoDelist: boolean; polling: boolean }) {
  const s = (await req(t.app, 'GET', '/api/settings')).json();
  s.statusChecks = { ...s.statusChecks, autoDelistOnSale: o.autoDelist, browserPollingEnabled: o.polling };
  await req(t.app, 'PUT', '/api/settings', s);
}
const detail = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}`)).json();
async function listedOn(mps: string[]) {
  const l = await seedListing(t.app);
  for (const mp of mps) await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/${mp}/mark-listed`, { url: `https://${mp}.example.com/${l.id}` });
  return l;
}

describe('sale listener', () => {
  it('records the sale and removes the item from the other marketplaces', async () => {
    const l = await listedOn(['mercari', 'poshmark']);
    script = ['sold'];
    await req(t.app, 'POST', '/api/status-checks/run', { marketplaceIds: ['mercari'] });
    await jobRunner.runOnce(t.db);
    const d = await detail(l.id);
    expect(d.soldAt).toBeTruthy();
    const rows = t.db.select().from(sales).where(eq(sales.listingId, l.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'detected', marketplaceId: 'mercari' });
    const deact = t.db.select().from(jobs).where(eq(jobs.listingId, l.id)).all().filter((j) => j.type === 'deactivate');
    expect(deact.map((j) => j.marketplaceId)).toEqual(['poshmark']);
  });

  it('looks again before believing a browser page: sold then active changes nothing', async () => {
    const l = await listedOn(['mercari', 'poshmark']);
    script = ['sold', 'active'];
    await req(t.app, 'POST', '/api/status-checks/run', { marketplaceIds: ['mercari'] });
    await jobRunner.runOnce(t.db);
    const d = await detail(l.id);
    expect(d.soldAt).toBeNull();
    expect(d.marketplaces.find((m: { marketplaceId: string }) => m.marketplaceId === 'mercari').status).toBe('active');
    expect(t.db.select().from(sales).where(eq(sales.listingId, l.id)).all()).toHaveLength(0);
  });

  it('with automatic removal off it only shows the banner', async () => {
    await setSettings({ autoDelist: false, polling: true });
    const l = await listedOn(['mercari', 'poshmark']);
    script = ['sold'];
    await req(t.app, 'POST', '/api/status-checks/run', { marketplaceIds: ['mercari'] });
    await jobRunner.runOnce(t.db);
    const d = await detail(l.id);
    expect(d.saleDetectedMarketplaceId).toBe('mercari');
    expect(d.soldAt).toBeNull();
    expect(t.db.select().from(sales).where(eq(sales.listingId, l.id)).all()).toHaveLength(0);
    expect(t.db.select().from(jobs).where(eq(jobs.listingId, l.id)).all().filter((j) => j.type === 'deactivate')).toHaveLength(0);
  });

  it('timed checks: 20 per marketplace per round, once per interval, and not when switched off', async () => {
    for (let i = 0; i < 25; i++) await listedOn(['mercari']);
    const r = pollBrowserMarketplaces(t.db);
    expect(r).toEqual({ ran: true, jobs: 20 });
    const timed = t.db.select().from(jobs).where(eq(jobs.type, 'status_check')).all().filter((j) => (j.input as { timed?: boolean } | null)?.timed);
    expect(timed).toHaveLength(20);
    expect(pollBrowserMarketplaces(t.db)).toEqual({ ran: false, jobs: 0 });
    t.db.update(jobs).set({ state: 'CANCELLED' }).where(eq(jobs.state, 'NOT_STARTED')).run();
    setKv(t.db, 'browser_last_poll', 0);
    await setSettings({ autoDelist: true, polling: false });
    expect(pollBrowserMarketplaces(t.db)).toEqual({ ran: false, jobs: 0 });
  });

  it('a failed timed check does not notify the user', async () => {
    await listedOn(['mercari']);
    script = [new Error('page exploded')];
    expect(pollBrowserMarketplaces(t.db).jobs).toBe(1);
    vi.mocked(notifyUser).mockClear();
    await jobRunner.runOnce(t.db);
    const failed = t.db.select().from(jobs).where(eq(jobs.state, 'FAILED')).all().filter((j) => j.type === 'status_check');
    expect(failed.length).toBeGreaterThan(0);
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
