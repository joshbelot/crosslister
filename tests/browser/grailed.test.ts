import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeLogin, readFilled, resetBrowser, setAutoSubmit, setOverrides, startFlowEnv, type FlowEnv } from '../helpers/adapterFlow';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('grailed adapter (fixtures — assisted, uncalibrated)', () => {
  let t: TestApp;
  let env: FlowEnv;
  let runner: typeof import('../../src/server/services/jobRunner').jobRunner;
  const job = async (id: string) => (await req(t.app, 'GET', `/api/jobs/${id}`)).json();
  const listing = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}`)).json();
  const urls = (sellQuery = '', editQuery = '') => setOverrides(env.fixtureUrl, 'grailed', {
    sell: `/grailed/sell.html${sellQuery}`, login: '/grailed/login.html', home: '/grailed/sell.html', edit: `/grailed/listings/{id}/edit${editQuery}`,
  });
  const waitUser = async (id: string) => {
    const start = Date.now();
    for (;;) {
      const j = await job(id);
      if (j.state === 'NEEDS_USER') return j;
      if (['FAILED', 'SUCCESS', 'CANCELLED'].includes(j.state)) throw new Error(`job ended early: ${j.state} ${j.errorMessage ?? ''} ${JSON.stringify(j.steps.map((x: { key: string; state: string; message: string }) => `${x.key}:${x.state}:${x.message ?? ''}`))}`);
      if (Date.now() - start > 60_000) throw new Error(`timed out; steps ${JSON.stringify(j.steps.map((x: { key: string; state: string }) => `${x.key}:${x.state}`))}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  beforeAll(async () => { env = await startFlowEnv(); t = await createTestApp(); runner = (await import('../../src/server/services/jobRunner')).jobRunner; });
  afterAll(async () => { await resetBrowser('grailed'); await t.cleanup(); await env.close(); });
  beforeEach(async () => { await resetBrowser('grailed'); urls(); });

  const start = async (extra: Record<string, unknown> = {}) => {
    const l = await seedListing(t.app, { brand: "Levi's", size: '32', ...extra });
    const res = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['grailed'] })).json();
    return { l, jobId: res.jobs[0].id as string };
  };

  it('happy path with autoSubmit: fills every field and records the listing id', async () => {
    await setAutoSubmit(t.app, 'grailed', true);
    await fakeLogin('grailed', env.fixtureUrl);
    const { l, jobId } = await start();
    await runner.runOnce(t.db);
    const j = await job(jobId);
    expect(j.state, j.errorMessage).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: '1234567', verified: true });
    expect(await readFilled('grailed')).toMatchObject({
      category: 'Menswear > Bottoms > Denim', designer: "Levi's", size: '32', title: 'Vintage Levi 501 Jeans', color: 'Blue', condition: 'Used',
      description: 'Great jeans.', price: '65', photos: ['01.jpg'],
    });
    expect((await listing(l.id)).marketplaces[0]).toMatchObject({ status: 'active', remoteId: '1234567' });
  }, 90_000);

  it('a missing control lands in NEEDS_USER; continue with a URL completes the job', async () => {
    await setAutoSubmit(t.app, 'grailed', true);
    urls('?missing=designer');
    await fakeLogin('grailed', env.fixtureUrl);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitUser(jobId);
    expect(waiting.needsUser.missingFields).toEqual(['Selecting designer']);
    await req(t.app, 'POST', `/api/jobs/${jobId}/continue`, { url: 'https://www.grailed.com/listings/7654321-my-item' });
    await run;
    expect((await job(jobId)).result).toMatchObject({ remoteId: '7654321', verified: true });
  }, 90_000);

  it('womenswear stops at the category level and asks you to choose the subcategory', async () => {
    await setAutoSubmit(t.app, 'grailed', true);
    await fakeLogin('grailed', env.fixtureUrl);
    const { jobId } = await start({ categoryId: 'women.tops.blouses', brand: 'Nike', size: 'M' });
    const run = runner.runOnce(t.db);
    const waiting = await waitUser(jobId);
    expect(waiting.needsUser.reason).toBe('fields');
    expect(waiting.needsUser.missingFields).toEqual(['Choosing subcategory']);
    await req(t.app, 'POST', `/api/jobs/${jobId}/continue`, {});
    // the user would finish the form and publish; here we just end the job by pasting a URL path as "published"
    await run.catch(() => undefined);
  }, 90_000);

  it('login path', async () => {
    await setAutoSubmit(t.app, 'grailed', true);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitUser(jobId);
    expect(waiting.needsUser.reason).toBe('login');
    const { browserManager } = await import('../../src/server/browser/browserManager');
    await (await browserManager.getPage('grailed')).getByRole('button', { name: 'Log in' }).click();
    await run;
    expect((await job(jobId)).state).toBe('SUCCESS');
  }, 120_000);

  it('deactivate: deletes the listing; a missing delete button falls back to the user', async () => {
    await setAutoSubmit(t.app, 'grailed', true);
    await fakeLogin('grailed', env.fixtureUrl);
    const l = await seedListing(t.app, { brand: "Levi's" });
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/grailed/mark-listed`, { url: 'https://www.grailed.com/listings/1234567-x' });
    const { job: d1 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/grailed/deactivate`)).json();
    await runner.runOnce(t.db);
    expect((await job(d1.id)).state).toBe('SUCCESS');

    urls('', '?missing=delete');
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/grailed/mark-listed`, { url: 'https://www.grailed.com/listings/1234567-x' });
    const { job: d2 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/grailed/deactivate`)).json();
    const run = runner.runOnce(t.db);
    const waiting = await waitUser(d2.id);
    expect(waiting.needsUser.reason).toBe('manual_delist');
    await req(t.app, 'POST', `/api/jobs/${d2.id}/continue`, {});
    await run;
    expect((await job(d2.id)).state).toBe('SUCCESS');
  }, 120_000);
});
