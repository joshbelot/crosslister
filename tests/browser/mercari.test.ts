import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '../helpers/fakeAdapter';
import { fakeLogin, readFilled, resetBrowser, setAutoSubmit, setOverrides, startFlowEnv, type FlowEnv } from '../helpers/adapterFlow';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('mercari adapter (fixtures — assisted, uncalibrated)', () => {
  let t: TestApp;
  let env: FlowEnv;
  let runner: typeof import('../../src/server/services/jobRunner').jobRunner;
  const job = async (id: string) => (await req(t.app, 'GET', `/api/jobs/${id}`)).json();
  const listing = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}`)).json();

  beforeAll(async () => {
    env = await startFlowEnv();
    t = await createTestApp();
    runner = (await import('../../src/server/services/jobRunner')).jobRunner;
  });
  afterAll(async () => {
    await resetBrowser('mercari');
    await t.cleanup();
    await env.close();
  });
  beforeEach(async () => {
    await resetBrowser('mercari');
    setOverrides(env.fixtureUrl, 'mercari', {
      sell: '/mercari/sell.html', login: '/mercari/login.html', home: '/mercari/sell.html', edit: '/mercari/edit.html?id={id}',
    });
  });

  const start = async (extra: Record<string, unknown> = {}) => {
    const l = await seedListing(t.app, { brand: "Levi's", ...extra });
    const res = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['mercari'] })).json();
    return { l, jobId: res.jobs[0].id as string };
  };

  it('happy path with autoSubmit: fills every field and records the remote id', async () => {
    await setAutoSubmit(t.app, 'mercari', true);
    await fakeLogin('mercari', env.fixtureUrl);
    const { l, jobId } = await start();
    await runner.runOnce(t.db);
    const j = await job(jobId);
    expect(j.state, JSON.stringify(j.errorMessage)).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: 'm12345678901', verified: true });
    const filled = await readFilled('mercari');
    expect(filled).toMatchObject({
      title: 'Vintage Levi 501 Jeans', description: 'Great jeans.', category: 'Men > Jeans', brand: "Levi's", condition: 'Good',
      size: '32', color: 'Blue', weightLb: '1', weightOz: '0', shippingPayer: 'Buyer', price: '65.00', smartPricing: 'false',
      photos: ['01.jpg'],
    });
    const d = await listing(l.id);
    expect(d.marketplaces[0]).toMatchObject({ status: 'active', remoteId: 'm12345678901', verified: true });
    expect(d.status).toBe('listed');
    expect(j.steps.map((s: { key: string; state: string }) => `${s.key}:${s.state}`)).toEqual([
      'photos:done', 'open:done', 'login:done', 'photos:done', 'title:done', 'description:done', 'category:done', 'brand:done',
      'condition:done', 'size:done', 'color:done', 'shipping:done', 'price:done', 'submit:done', 'confirm:done',
    ]);
  }, 90_000);

  it('a missing control lands in NEEDS_USER with the field listed; continue with a URL completes the job', async () => {
    await setAutoSubmit(t.app, 'mercari', true);
    setOverrides(env.fixtureUrl, 'mercari', { sell: '/mercari/sell.html?missing=brand', login: '/mercari/login.html', home: '/mercari/sell.html' });
    await fakeLogin('mercari', env.fixtureUrl);
    const { l, jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.reason).toBe('fields');
    expect(waiting.needsUser.missingFields).toEqual(['Selecting brand']);
    expect(waiting.needsUser.copyFields.map((f: { label: string }) => f.label)).toEqual(expect.arrayContaining(['Title', 'Price', 'Brand']));
    expect(waiting.steps.find((s: { key: string }) => s.key === 'brand')).toMatchObject({ state: 'needs_user' });
    const cont = await req(t.app, 'POST', `/api/jobs/${jobId}/continue`, { url: 'https://www.mercari.com/us/item/m99999999999/' });
    expect(cont.statusCode).toBe(200);
    await run;
    const j = await job(jobId);
    expect(j.state).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: 'm99999999999', verified: true });
    expect((await listing(l.id)).marketplaces[0].status).toBe('active');
  }, 90_000);

  it('without autoSubmit it waits for the user to click List and detects the new listing', async () => {
    await setAutoSubmit(t.app, 'mercari', false);
    await fakeLogin('mercari', env.fixtureUrl);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.reason).toBe('review_and_submit');
    const { browserManager } = await import('../../src/server/browser/browserManager');
    const page = await browserManager.getPage('mercari');
    await page.getByRole('button', { name: 'List', exact: true }).click(); // the user clicks the final button
    await run;
    const j = await job(jobId);
    expect(j.state).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: 'm12345678901', verified: true });
  }, 90_000);

  it('login path: asks the user to log in, then continues automatically', async () => {
    await setAutoSubmit(t.app, 'mercari', true);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.reason).toBe('login');
    expect(waiting.needsUser.title).toBe('Log in to Mercari');
    const { browserManager } = await import('../../src/server/browser/browserManager');
    const page = await browserManager.getPage('mercari');
    await page.getByRole('button', { name: 'Log in' }).click(); // the user logs in
    await run;
    const j = await job(jobId);
    expect(j.state, JSON.stringify(j.errorMessage)).toBe('SUCCESS');
    const conns = (await req(t.app, 'GET', '/api/marketplaces')).json();
    expect(conns.find((m: { id: string }) => m.id === 'mercari').connection.status).toBe('connected');
  }, 120_000);

  it('deactivate: clicks Deactivate and confirms; a missing button falls back to the user', async () => {
    await setAutoSubmit(t.app, 'mercari', true);
    await fakeLogin('mercari', env.fixtureUrl);
    const l = await seedListing(t.app, { brand: "Levi's" });
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/mercari/mark-listed`, { url: 'https://www.mercari.com/us/item/m12345678901/' });
    const { job: dj } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/mercari/deactivate`)).json();
    await runner.runOnce(t.db);
    expect((await job(dj.id)).state).toBe('SUCCESS');
    expect((await listing(l.id)).marketplaces[0].status).toBe('ended');

    // missing control → manual_delist, no failure
    setOverrides(env.fixtureUrl, 'mercari', { sell: '/mercari/sell.html', login: '/mercari/login.html', home: '/mercari/sell.html', edit: '/mercari/edit.html?missing=deactivate&id={id}' });
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/mercari/mark-listed`, { url: 'https://www.mercari.com/us/item/m12345678901/' });
    const { job: dj2 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/mercari/deactivate`)).json();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(dj2.id); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.reason).toBe('manual_delist');
    await req(t.app, 'POST', `/api/jobs/${dj2.id}/continue`, {});
    await run;
    expect((await job(dj2.id)).state).toBe('SUCCESS');
  }, 120_000);
});
