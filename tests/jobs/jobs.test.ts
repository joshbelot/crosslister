import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deferred, fakeAdapter, waitFor } from '../helpers/fakeAdapter';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { __setAdaptersForTest, allAdapters } from '../../src/server/marketplaces/registry';
import { AdapterError, toAdapterError } from '../../src/server/marketplaces/common';
import { jobRunner } from '../../src/server/services/jobRunner';
import { jobs, marketplaceListings } from '../../src/server/db/schema';
import { recoverInterruptedJobs } from '../../src/server/services/jobs';

let t: TestApp;
const real = allAdapters();
beforeAll(async () => {
  t = await createTestApp();
  const s = (await req(t.app, 'GET', '/api/settings')).json();
  for (const mp of Object.keys(s.marketplaces)) s.marketplaces[mp].dailyLimit = 200;
  await req(t.app, 'PUT', '/api/settings', s);
});
afterAll(async () => { __setAdaptersForTest(null); await t.cleanup(); });
afterEach(async () => { await jobRunner.idle(); __setAdaptersForTest(real); });

const useAdapters = (list: ReturnType<typeof fakeAdapter>[]) => {
  const ids = new Set(list.map((a) => a.id));
  __setAdaptersForTest([...list, ...real.filter((a) => !ids.has(a.id))]);
};
const crosslist = (id: string, marketplaceIds: string[]) => req(t.app, 'POST', `/api/listings/${id}/crosslist`, { marketplaceIds });
const getJob = async (id: string) => (await req(t.app, 'GET', `/api/jobs/${id}`)).json();
const getListing = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}`)).json();

describe('crosslist', () => {
  it('orders api → browser → manual and creates NOT_STARTED jobs', async () => {
    useAdapters([fakeAdapter('ebay', { kind: 'api' }), fakeAdapter('mercari', { kind: 'browser' }), fakeAdapter('poshmark', { kind: 'browser' }), fakeAdapter('vinted', { kind: 'manual' })]);
    const l = await seedListing(t.app);
    const res = await crosslist(l.id, ['vinted', 'poshmark', 'ebay', 'mercari']);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs.map((j: { marketplaceId: string }) => j.marketplaceId)).toEqual(['ebay', 'mercari', 'poshmark', 'vinted']);
    expect(body.jobs.every((j: { state: string }) => j.state === 'NOT_STARTED')).toBe(true);
    expect(body.skipped).toEqual([]);
    const detail = await getListing(l.id);
    expect(detail.marketplaces.every((m: { status: string }) => m.status === 'in_progress')).toBe(true);
    expect(detail.activeJobs).toHaveLength(4);
    // second call: all already in progress
    const again = (await crosslist(l.id, ['ebay'])).json();
    expect(again.jobs).toEqual([]);
    expect(again.skipped).toEqual([{ marketplaceId: 'ebay', reason: 'Already in progress' }]);
    await jobRunner.runOnce(t.db);
  });

  it('skips active targets and enforces the daily limit; 422 when not ready', async () => {
    useAdapters([fakeAdapter('mercari', { kind: 'browser' }), fakeAdapter('depop', { kind: 'browser' })]);
    const s = (await req(t.app, 'GET', '/api/settings')).json();
    s.marketplaces.depop.dailyLimit = 1;
    await req(t.app, 'PUT', '/api/settings', s);
    const a = await seedListing(t.app);
    await req(t.app, 'POST', `/api/listings/${a.id}/marketplaces/mercari/mark-listed`, { url: 'https://mercari.example.com/m1' });
    const res = (await crosslist(a.id, ['mercari', 'depop'])).json();
    expect(res.skipped).toEqual([{ marketplaceId: 'mercari', reason: 'Already listed' }]);
    expect(res.jobs).toHaveLength(1);
    await jobRunner.runOnce(t.db);

    const b = await seedListing(t.app, { title: 'Second' });
    const lim = (await crosslist(b.id, ['depop'])).json();
    expect(lim.jobs).toEqual([]);
    expect(lim.skipped[0].reason).toBe("You've reached today's limit for Depop (1).");

    const empty = (await req(t.app, 'POST', '/api/listings', {})).json();
    const bad = await crosslist(empty.id, ['mercari']);
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('NOT_READY');
    expect(bad.json().error.details.marketplaces[0].ready).toBe(false);
  });
});

describe('runner', () => {
  it('runs one job per marketplace at a time, parallel across marketplaces, max 4 total', async () => {
    const gate = deferred();
    let active = 0; let maxActive = 0;
    const perMp: Record<string, number> = {}; const maxPerMp: Record<string, number> = {};
    const mk = (id: 'mercari' | 'poshmark' | 'depop' | 'facebook' | 'ebay') => fakeAdapter(id, {
      kind: 'browser',
      publish: async (ctx) => {
        active++; maxActive = Math.max(maxActive, active);
        perMp[id] = (perMp[id] ?? 0) + 1; maxPerMp[id] = Math.max(maxPerMp[id] ?? 0, perMp[id]!);
        await gate.promise;
        active--; perMp[id]!--;
        return { remoteId: ctx.job.id, url: null, verified: false };
      },
    });
    useAdapters([mk('mercari'), mk('poshmark'), mk('depop'), mk('facebook'), mk('ebay')]);
    const l1 = await seedListing(t.app, { title: 'C1' });
    const l2 = await seedListing(t.app, { title: 'C2' });
    await crosslist(l1.id, ['mercari', 'poshmark', 'depop', 'facebook', 'ebay']);
    await crosslist(l2.id, ['mercari']);
    const run = jobRunner.runOnce(t.db);
    await waitFor(() => active === 4);
    await new Promise((r) => setTimeout(r, 100));
    expect(active).toBe(4); // 5 distinct marketplaces ready but the cap is 4
    gate.resolve();
    await run;
    expect(maxActive).toBe(4);
    expect(maxPerMp.mercari).toBe(1);
    expect(t.db.select().from(jobs).where(eq(jobs.state, 'SUCCESS')).all().length).toBeGreaterThanOrEqual(6);
  });

  it('success updates the marketplace listing and listing status', async () => {
    useAdapters([fakeAdapter('mercari', { kind: 'browser', publish: async (ctx) => { await ctx.step('fill', 'Filling', async () => undefined); return { remoteId: 'abc', url: 'https://mercari.example.com/abc', verified: true }; } })]);
    const l = await seedListing(t.app);
    const { jobs: created } = (await crosslist(l.id, ['mercari'])).json();
    await jobRunner.runOnce(t.db);
    const j = await getJob(created[0].id);
    expect(j.state).toBe('SUCCESS');
    expect(j.result).toEqual({ remoteId: 'abc', url: 'https://mercari.example.com/abc', verified: true });
    expect(j.steps.map((s: { key: string; state: string }) => [s.key, s.state])).toEqual([['photos', 'done'], ['fill', 'done']]);
    const d = await getListing(l.id);
    expect(d.marketplaces[0]).toMatchObject({ status: 'active', remoteId: 'abc', url: 'https://mercari.example.com/abc', verified: true });
    expect(d.marketplaces[0].listedAt).toBeTruthy();
    expect(d.status).toBe('listed');
    const files = await import('node:fs').then((fs) => fs.readdirSync(`${t.dataDir}/data/listings/${l.id}/processed/mercari`));
    expect(files).toEqual(['01.jpg']);
  });

  it('failure marks the job FAILED, the target error and does not list the item', async () => {
    useAdapters([fakeAdapter('mercari', { kind: 'browser', publish: async () => { throw new AdapterError('ELEMENT_NOT_FOUND', "Mercari's page didn't look the way the app expected (couldn't find “Title”). Mercari may have changed its website."); } })]);
    const l = await seedListing(t.app);
    const { jobs: created } = (await crosslist(l.id, ['mercari'])).json();
    await jobRunner.runOnce(t.db);
    const j = await getJob(created[0].id);
    expect(j.state).toBe('FAILED');
    expect(j.errorCode).toBe('ELEMENT_NOT_FOUND');
    expect(j.errorMessage).toContain('couldn\'t find “Title”');
    const d = await getListing(l.id);
    expect(d.marketplaces[0]).toMatchObject({ status: 'error', lastErrorCode: 'ELEMENT_NOT_FOUND' });
    expect(d.status).not.toBe('listed');
    expect(d.needsAttention).toBe(true);
  });

  it('unexpected errors become UNKNOWN with a friendly message', async () => {
    useAdapters([fakeAdapter('mercari', { kind: 'browser', publish: async () => { throw new Error('kaboom internal detail'); } })]);
    const l = await seedListing(t.app);
    const { jobs: created } = (await crosslist(l.id, ['mercari'])).json();
    await jobRunner.runOnce(t.db);
    const j = await getJob(created[0].id);
    expect(j.errorCode).toBe('UNKNOWN');
    expect(j.errorMessage).toBe('Something unexpected happened with Mercari. Details were written to the log.');
    expect(JSON.stringify(j)).not.toContain('kaboom');
  });
});

describe('needs-user flow', () => {
  it('requestUser → NEEDS_USER → continue with url → SUCCESS', async () => {
    useAdapters([fakeAdapter('vinted', { publish: async (ctx) => {
      const a = await ctx.requestUser({ reason: 'manual_listing', title: 'List on Vinted', instructions: 'Do it', allowUrlInput: true, primaryAction: 'I listed it' });
      return { remoteId: 'v1', url: a.url, verified: Boolean(a.url) };
    } })]);
    const l = await seedListing(t.app);
    const { jobs: created } = (await crosslist(l.id, ['vinted'])).json();
    const run = jobRunner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await getJob(created[0].id); return j.state === 'NEEDS_USER' ? j : null; });
    expect(waiting.needsUser.title).toBe('List on Vinted');
    expect((await getListing(l.id)).needsAttention).toBe(true);
    const cont = await req(t.app, 'POST', `/api/jobs/${created[0].id}/continue`, { url: 'https://vinted.example.com/items/1' });
    expect(cont.statusCode).toBe(200);
    await run;
    const j = await getJob(created[0].id);
    expect(j.state).toBe('SUCCESS');
    expect(j.result.url).toBe('https://vinted.example.com/items/1');
    expect(j.needsUser).toBeNull();
    const again = await req(t.app, 'POST', `/api/jobs/${created[0].id}/continue`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('JOB_NOT_WAITING');
  });

  it('requestUserUntil resolves by detection and clears NEEDS_USER', async () => {
    const detect = deferred<string>();
    useAdapters([fakeAdapter('mercari', { kind: 'browser', publish: async (ctx) => {
      const r = await ctx.requestUserUntil({ reason: 'review_and_submit', title: 'Review', instructions: 'x', primaryAction: 'Done' }, () => detect.promise);
      return { remoteId: r.by === 'detected' ? r.value : 'user', url: null, verified: true };
    } })]);
    const l = await seedListing(t.app);
    const { jobs: created } = (await crosslist(l.id, ['mercari'])).json();
    const run = jobRunner.runOnce(t.db);
    await waitFor(async () => (await getJob(created[0].id)).state === 'NEEDS_USER');
    detect.resolve('detected-id');
    await run;
    const j = await getJob(created[0].id);
    expect(j.state).toBe('SUCCESS');
    expect(j.result.remoteId).toBe('detected-id');
    expect(j.needsUser).toBeNull();
  });

  it('cancel while waiting → CANCELLED, target restored; retry creates attempt 2', async () => {
    useAdapters([fakeAdapter('vinted', { publish: async (ctx) => { await ctx.requestUser({ reason: 'other', title: 'Wait', instructions: 'x', primaryAction: 'Go' }); return { remoteId: 'r', url: null, verified: false }; } })]);
    const l = await seedListing(t.app);
    const { jobs: created } = (await crosslist(l.id, ['vinted'])).json();
    const run = jobRunner.runOnce(t.db);
    await waitFor(async () => (await getJob(created[0].id)).state === 'NEEDS_USER');
    const c = await req(t.app, 'POST', `/api/jobs/${created[0].id}/cancel`);
    expect(c.statusCode).toBe(200);
    await run;
    const j = await getJob(created[0].id);
    expect(j.state).toBe('CANCELLED');
    expect((await getListing(l.id)).marketplaces[0].status).toBe('not_listed');

    const retry = await req(t.app, 'POST', `/api/jobs/${created[0].id}/retry`);
    expect(retry.statusCode).toBe(200);
    const nj = retry.json();
    expect(nj).toMatchObject({ attempt: 2, parentJobId: created[0].id, state: 'NOT_STARTED', type: 'publish' });
    expect((await getListing(l.id)).marketplaces[0].status).toBe('in_progress');
    expect((await req(t.app, 'POST', `/api/jobs/${nj.id}/retry`)).statusCode).toBe(409);
    // cancel the not-started retry
    const c2 = (await req(t.app, 'POST', `/api/jobs/${nj.id}/cancel`)).json();
    expect(c2.state).toBe('CANCELLED');
    expect((await getListing(l.id)).marketplaces[0].status).toBe('not_listed');
  });

  it('tryStep failure records missingFields and a needs_user step', async () => {
    let missing: string[] = [];
    useAdapters([fakeAdapter('mercari', { kind: 'browser', publish: async (ctx) => {
      const ok = await ctx.tryStep('brand', 'Brand', async () => { throw new AdapterError('ELEMENT_NOT_FOUND', 'nope'); });
      expect(ok).toBe(false);
      await ctx.tryStep('size', 'Size', async () => undefined);
      missing = ctx.missingFields;
      return { remoteId: null, url: null, verified: false };
    } })]);
    const l = await seedListing(t.app);
    const { jobs: created } = (await crosslist(l.id, ['mercari'])).json();
    await jobRunner.runOnce(t.db);
    expect(missing).toEqual(['Brand']);
    const j = await getJob(created[0].id);
    const brand = j.steps.find((s: { key: string }) => s.key === 'brand');
    expect(brand).toMatchObject({ state: 'needs_user', message: "Couldn't fill automatically — please fill “Brand” in the browser" });
  });
});

describe('deactivate and connect', () => {
  it('deactivate job ends the target; 409 when not active', async () => {
    useAdapters([fakeAdapter('vinted', {})]);
    const l = await seedListing(t.app);
    expect((await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/deactivate`)).statusCode).toBe(404);
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/mark-listed`, {});
    const { job } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/deactivate`)).json();
    await jobRunner.runOnce(t.db);
    expect((await getJob(job.id)).state).toBe('SUCCESS');
    const d = await getListing(l.id);
    expect(d.marketplaces[0].status).toBe('ended');
    const again = await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/deactivate`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('NOT_ACTIVE');
  });
  it('connect job stores the connection', async () => {
    useAdapters([fakeAdapter('mercari', { kind: 'browser' })]);
    const { job } = (await req(t.app, 'POST', '/api/marketplaces/mercari/connect')).json();
    await jobRunner.runOnce(t.db);
    expect((await getJob(job.id)).state).toBe('SUCCESS');
    const list = (await req(t.app, 'GET', '/api/marketplaces')).json();
    expect(list.find((m: { id: string }) => m.id === 'mercari').connection).toMatchObject({ status: 'connected', accountName: 'tester' });
  });
});

describe('recovery and error mapping', () => {
  it('recovers interrupted jobs at startup', async () => {
    useAdapters([fakeAdapter('mercari', { kind: 'browser' }), fakeAdapter('poshmark', { kind: 'browser' })]);
    const l = await seedListing(t.app);
    const { jobs: created } = (await crosslist(l.id, ['mercari', 'poshmark'])).json() as { jobs: Array<{ id: string; marketplaceId: string }> };
    t.db.update(jobs).set({ state: 'IN_PROGRESS' }).where(eq(jobs.id, created[0]!.id)).run();
    recoverInterruptedJobs(t.db);
    const a = await getJob(created[0]!.id);
    const b = await getJob(created[1]!.id);
    expect(a).toMatchObject({ state: 'FAILED', errorCode: 'APP_RESTARTED' });
    expect(b).toMatchObject({ state: 'CANCELLED', errorMessage: 'Cancelled because the app restarted.' });
    const d = await getListing(l.id);
    const status = Object.fromEntries(d.marketplaces.map((m: { marketplaceId: string; status: string }) => [m.marketplaceId, m.status]));
    expect(status).toEqual({ mercari: 'error', poshmark: 'not_listed' });
    void marketplaceListings;
  });

  it('toAdapterError maps known failures', () => {
    const name = 'Mercari';
    expect(toAdapterError(Object.assign(new Error('x'), { name: 'TimeoutError' }), name).code).toBe('TIMEOUT');
    expect(toAdapterError(new Error('Target page, context or browser has been closed'), name).code).toBe('BROWSER_CLOSED');
    expect(toAdapterError(Object.assign(new Error('aborted'), { name: 'AbortError' }), name).code).toBe('CANCELLED');
    expect(toAdapterError(new TypeError('fetch failed'), name).code).toBe('NETWORK');
    expect(toAdapterError(new Error('getaddrinfo ENOTFOUND x'), name).code).toBe('NETWORK');
    const unk = toAdapterError(new Error('weird'), name);
    expect(unk.code).toBe('UNKNOWN');
    expect(unk.userMessage).toBe('Something unexpected happened with Mercari. Details were written to the log.');
    const own = new AdapterError('LOGIN_REQUIRED', "You're not logged in to Mercari.");
    expect(toAdapterError(own, name)).toBe(own);
  });
});
