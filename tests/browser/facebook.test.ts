import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '../helpers/fakeAdapter';
import { fakeLogin, readFilled, resetBrowser, setAutoSubmit, setOverrides, startFlowEnv, type FlowEnv } from '../helpers/adapterFlow';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('facebook adapter (fixtures — assisted, uncalibrated)', () => {
  let t: TestApp;
  let env: FlowEnv;
  let runner: typeof import('../../src/server/services/jobRunner').jobRunner;
  const job = async (id: string) => (await req(t.app, 'GET', `/api/jobs/${id}`)).json();
  const listing = async (id: string) => (await req(t.app, 'GET', `/api/listings/${id}`)).json();
  const urls = (sellQuery = '', itemQuery = '') => setOverrides(env.fixtureUrl, 'facebook', {
    sell: `/facebook/sell.html${sellQuery}`, login: '/facebook/login.html', home: '/facebook/sell.html',
    item: `/facebook/marketplace/item/{id}/${itemQuery}`, myListings: '/facebook/marketplace/you/selling',
  });
  const clickInBrowser = async (name: string) => {
    const { browserManager } = await import('../../src/server/browser/browserManager');
    await (await browserManager.getPage('facebook')).getByRole('button', { name, exact: true }).click();
  };

  beforeAll(async () => { env = await startFlowEnv(); t = await createTestApp(); runner = (await import('../../src/server/services/jobRunner')).jobRunner; });
  afterAll(async () => { await resetBrowser('facebook'); await t.cleanup(); await env.close(); });
  beforeEach(async () => { await resetBrowser('facebook'); urls(); });

  const start = async () => {
    const l = await seedListing(t.app, { brand: "Levi's", size: 'M', title: 'Vintage Levi 501 Jeans' });
    const res = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['facebook'] })).json();
    return { l, jobId: res.jobs[0].id as string };
  };
  const waitReview = async (jobId: string) => {
    const start = Date.now();
    for (;;) {
      const j = await job(jobId);
      if (j.state === 'NEEDS_USER') return j;
      if (j.state === 'FAILED' || j.state === 'SUCCESS') throw new Error(`job ended early: ${j.state} ${j.errorMessage ?? ''} ${JSON.stringify(j.steps)}`);
      if (Date.now() - start > 60_000) throw new Error('timed out waiting for the user prompt');
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  it('fills the form but never clicks Publish itself; detects the item page once the user publishes', async () => {
    await setAutoSubmit(t.app, 'facebook', true); // forced off by the server
    await fakeLogin('facebook', env.fixtureUrl);
    const { l, jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitReview(jobId);
    expect(waiting.needsUser.reason).toBe('review_and_submit');
    expect(waiting.needsUser.instructions).toContain('click “Publish” in the browser');
    expect(JSON.stringify(waiting.steps.map((s: { key: string }) => s.key))).not.toContain('submit');
    await clickInBrowser('Publish'); // the user
    await run;
    const j = await job(jobId);
    expect(j.state, j.errorMessage).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: '1234567890123456', verified: true });
    expect(await readFilled('facebook')).toMatchObject({
      title: 'Vintage Levi 501 Jeans', price: '65', category: "Men's Clothing", condition: 'Used - Good', description: 'Great jeans.', brand: "Levi's", size: 'M', photos: ['01.jpg'],
    });
    expect((await listing(l.id)).marketplaces[0]).toMatchObject({ status: 'active', remoteId: '1234567890123456' });
  }, 90_000);

  it('when Facebook lands on "Your listings", finds the new listing by title', async () => {
    urls('?publishTo=selling');
    await fakeLogin('facebook', env.fixtureUrl);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    await waitReview(jobId);
    await clickInBrowser('Publish');
    await run;
    const j = await job(jobId);
    expect(j.state, j.errorMessage).toBe('SUCCESS');
    expect(j.result).toMatchObject({ remoteId: '1234567890123456', verified: true });
  }, 90_000);

  it('a missing optional control becomes a needs-attention field', async () => {
    urls('?missing=condition');
    await fakeLogin('facebook', env.fixtureUrl);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitReview(jobId);
    expect(waiting.needsUser.reason).toBe('fields');
    expect(waiting.needsUser.missingFields).toEqual(['Selecting condition']);
    await req(t.app, 'POST', `/api/jobs/${jobId}/continue`, { url: 'https://www.facebook.com/marketplace/item/555/' });
    await run;
    expect((await job(jobId)).result).toMatchObject({ remoteId: '555', verified: true });
  }, 90_000);

  it('login path', async () => {
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitReview(jobId);
    expect(waiting.needsUser.reason).toBe('login');
    await clickInBrowser('Log in');
    const second = await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' && j.needsUser.reason !== 'login' ? j : null; }, 60_000);
    expect(second.needsUser.reason).toBe('review_and_submit');
    await clickInBrowser('Publish');
    await run;
    expect((await job(jobId)).state).toBe('SUCCESS');
  }, 120_000);

  it('deactivate: the user always clicks the final Delete; missing menu falls back to manual removal', async () => {
    await fakeLogin('facebook', env.fixtureUrl);
    const l = await seedListing(t.app, { brand: "Levi's" });
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/facebook/mark-listed`, { url: 'https://www.facebook.com/marketplace/item/1234567890123456/' });
    const { job: d1 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/facebook/deactivate`)).json();
    const run = runner.runOnce(t.db);
    const waiting = await waitReview(d1.id);
    expect(waiting.needsUser.reason).toBe('confirm_delete');
    await clickInBrowser('Delete'); // the user confirms in the dialog
    await run;
    expect((await job(d1.id)).state).toBe('SUCCESS');
    expect((await listing(l.id)).marketplaces[0].status).toBe('ended');

    urls('', '?missing=menu');
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/facebook/mark-listed`, { url: 'https://www.facebook.com/marketplace/item/1234567890123456/' });
    const { job: d2 } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/facebook/deactivate`)).json();
    const run2 = runner.runOnce(t.db);
    const w2 = await waitReview(d2.id);
    expect(w2.needsUser.reason).toBe('manual_delist');
    await req(t.app, 'POST', `/api/jobs/${d2.id}/continue`, {});
    await run2;
    expect((await job(d2.id)).state).toBe('SUCCESS');
  }, 120_000);
});
