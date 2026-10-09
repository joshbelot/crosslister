import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '../helpers/fakeAdapter';
import { fakeLogin, readFilled, resetBrowser, setAutoSubmit, setOverrides, startFlowEnv, type FlowEnv } from '../helpers/adapterFlow';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

const ID = '0123456789abcdef01234567';

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('poshmark adapter (fixtures — assisted, uncalibrated)', () => {
  let t: TestApp;
  let env: FlowEnv;
  let runner: typeof import('../../src/server/services/jobRunner').jobRunner;
  const job = async (id: string) => (await req(t.app, 'GET', `/api/jobs/${id}`)).json();
  const listing = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}`)).json();
  const urls = (sellQuery = '', editQuery = '') => setOverrides(env.fixtureUrl, 'poshmark', {
    sell: `/poshmark/sell.html${sellQuery}`, login: '/poshmark/login.html', home: '/poshmark/sell.html', edit: `/poshmark/edit-listing/{id}${editQuery}`,
  });

  beforeAll(async () => { env = await startFlowEnv(); t = await createTestApp(); runner = (await import('../../src/server/services/jobRunner')).jobRunner; });
  afterAll(async () => { await resetBrowser('poshmark'); await t.cleanup(); await env.close(); });
  beforeEach(async () => { await resetBrowser('poshmark'); urls(); });

  const start = async () => {
    const l = await seedListing(t.app, { brand: "Levi's", msrpCents: 12000 });
    const res = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['poshmark'] })).json();
    return { l, jobId: res.jobs[0].id as string };
  };
  const localStorageValue = async (key: string) => {
    const { browserManager } = await import('../../src/server/browser/browserManager');
    return (await browserManager.getPage('poshmark')).evaluate((k) => localStorage.getItem(k), key);
  };

  it('happy path with autoSubmit: fills the form, opens the review page, lists and records the id', async () => {
    await setAutoSubmit(t.app, 'poshmark', true);
    await fakeLogin('poshmark', env.fixtureUrl);
    const { l, jobId } = await start();
    await runner.runOnce(t.db);
    const j = await job(jobId);
    expect(j.state, JSON.stringify(j.errorMessage)).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: ID, verified: true });
    expect(await readFilled('poshmark')).toMatchObject({
      title: 'Vintage Levi 501 Jeans', description: 'Great jeans.', category: 'Men > Jeans', size: '32', condition: 'Good', brand: "Levi's",
      colors: ['Blue'], styleTags: [], originalPrice: '120', listingPrice: '65', photos: ['01.jpg'],
    });
    expect(j.steps.map((s: { key: string }) => s.key)).toEqual([
      'photos', 'open', 'login', 'photos', 'title', 'description', 'category', 'size', 'condition', 'brand', 'colors', 'styleTags',
      'originalPrice', 'listingPrice', 'next', 'submit', 'confirm',
    ]);
    expect((await listing(l.id)).marketplaces[0]).toMatchObject({ status: 'active', remoteId: ID });
  }, 90_000);

  it('a missing control lands in NEEDS_USER; continue with a URL completes the job', async () => {
    await setAutoSubmit(t.app, 'poshmark', true);
    urls('?missing=size');
    await fakeLogin('poshmark', env.fixtureUrl);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.reason).toBe('fields');
    expect(waiting.needsUser.missingFields).toEqual(['Selecting size']);
    await req(t.app, 'POST', `/api/jobs/${jobId}/continue`, { url: `https://poshmark.com/listing/my-item-${ID}` });
    await run;
    const j = await job(jobId);
    expect(j.state).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: ID, verified: true });
  }, 90_000);

  it('login path: asks the user to log in, then continues', async () => {
    await setAutoSubmit(t.app, 'poshmark', true);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.reason).toBe('login');
    const { browserManager } = await import('../../src/server/browser/browserManager');
    await (await browserManager.getPage('poshmark')).getByRole('button', { name: 'Log in' }).click();
    await run;
    expect((await job(jobId)).state).toBe('SUCCESS');
  }, 120_000);

  it('deactivate: sets Not For Sale and updates; falls back to deleting when availability is missing', async () => {
    await setAutoSubmit(t.app, 'poshmark', true);
    await fakeLogin('poshmark', env.fixtureUrl);
    const l = await seedListing(t.app, { brand: "Levi's", msrpCents: 12000 });
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/poshmark/mark-listed`, { url: `https://poshmark.com/listing/x-${ID}` });
    const { job: d1 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/poshmark/deactivate`)).json();
    await runner.runOnce(t.db);
    expect((await job(d1.id)).state).toBe('SUCCESS');
    expect(await localStorageValue('cl-availability')).toBe('Not For Sale');
    expect((await listing(l.id)).marketplaces[0].status).toBe('ended');

    urls('', '?missing=availability');
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/poshmark/mark-listed`, { url: `https://poshmark.com/listing/x-${ID}` });
    const { job: d2 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/poshmark/deactivate`)).json();
    await runner.runOnce(t.db);
    expect((await job(d2.id)).state).toBe('SUCCESS');
    expect(await localStorageValue('cl-deleted')).toBe('1');
  }, 120_000);
});
