import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '../helpers/fakeAdapter';
import { fakeLogin, readFilled, resetBrowser, setAutoSubmit, setOverrides, startFlowEnv, type FlowEnv } from '../helpers/adapterFlow';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('depop adapter (fixtures — assisted, uncalibrated)', () => {
  let t: TestApp;
  let env: FlowEnv;
  let runner: typeof import('../../src/server/services/jobRunner').jobRunner;
  const job = async (id: string) => (await req(t.app, 'GET', `/api/jobs/${id}`)).json();
  const listing = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}`)).json();
  const urls = (sellQuery = '', editQuery = '') => setOverrides(env.fixtureUrl, 'depop', {
    sell: `/depop/sell.html${sellQuery}`, login: '/depop/login.html', home: '/depop/sell.html', edit: `/depop/products/edit/{id}/${editQuery}`,
  });

  beforeAll(async () => { env = await startFlowEnv(); t = await createTestApp(); runner = (await import('../../src/server/services/jobRunner')).jobRunner; });
  afterAll(async () => { await resetBrowser('depop'); await t.cleanup(); await env.close(); });
  beforeEach(async () => { await resetBrowser('depop'); urls(); });

  const start = async () => {
    const l = await seedListing(t.app, { brand: "Levi's", tags: ['Vintage', 'denim'] });
    const res = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['depop'] })).json();
    return { l, jobId: res.jobs[0].id as string };
  };

  it('happy path: fills every field (title folded into the description) and records the slug', async () => {
    await setAutoSubmit(t.app, 'depop', true);
    await fakeLogin('depop', env.fixtureUrl);
    const { l, jobId } = await start();
    await runner.runOnce(t.db);
    const j = await job(jobId);
    expect(j.state, JSON.stringify(j.errorMessage)).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: 'vintage-levis-jeans-abc', verified: true });
    expect(await readFilled('depop')).toMatchObject({
      description: 'Vintage Levi 501 Jeans\n\nGreat jeans.\n\n#vintage #denim', category: 'Menswear > Bottoms > Jeans', brand: "Levi's",
      condition: 'Used - Excellent', size: 'US 32', colors: ['Blue'], price: '65.00', parcel: 'Medium', photos: ['01.jpg'],
    });
    expect((await listing(l.id)).marketplaces[0]).toMatchObject({ status: 'active', remoteId: 'vintage-levis-jeans-abc' });
  }, 90_000);

  it('a missing control lands in NEEDS_USER; continue with a URL completes the job', async () => {
    await setAutoSubmit(t.app, 'depop', true);
    urls('?missing=parcel');
    await fakeLogin('depop', env.fixtureUrl);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.missingFields).toEqual(['Choosing parcel size']);
    await req(t.app, 'POST', `/api/jobs/${jobId}/continue`, { url: 'https://www.depop.com/products/my-own-slug-1/' });
    await run;
    const j = await job(jobId);
    expect(j.state).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: 'my-own-slug-1', verified: true });
  }, 90_000);

  it('login path', async () => {
    await setAutoSubmit(t.app, 'depop', true);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.reason).toBe('login');
    const { browserManager } = await import('../../src/server/browser/browserManager');
    await (await browserManager.getPage('depop')).getByRole('button', { name: 'Log in' }).click();
    await run;
    expect((await job(jobId)).state).toBe('SUCCESS');
  }, 120_000);

  it('deactivate: deletes the listing; a missing delete button falls back to the user', async () => {
    await setAutoSubmit(t.app, 'depop', true);
    await fakeLogin('depop', env.fixtureUrl);
    const l = await seedListing(t.app, { brand: "Levi's" });
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/depop/mark-listed`, { url: 'https://www.depop.com/products/vintage-levis-jeans-abc/' });
    const { job: d1 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/depop/deactivate`)).json();
    await runner.runOnce(t.db);
    expect((await job(d1.id)).state).toBe('SUCCESS');
    expect((await listing(l.id)).marketplaces[0].status).toBe('ended');

    urls('', '?missing=delete');
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/depop/mark-listed`, { url: 'https://www.depop.com/products/vintage-levis-jeans-abc/' });
    const { job: d2 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/depop/deactivate`)).json();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(d2.id); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.reason).toBe('manual_delist');
    await req(t.app, 'POST', `/api/jobs/${d2.id}/continue`, {});
    await run;
    expect((await job(d2.id)).state).toBe('SUCCESS');
  }, 120_000);
});
