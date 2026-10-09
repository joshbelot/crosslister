import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '../helpers/fakeAdapter';
import { fakeLogin, resetBrowser, setOverrides, startFlowEnv, type FlowEnv } from '../helpers/adapterFlow';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('shop-page import (fixtures — assisted, uncalibrated)', () => {
  let t: TestApp;
  let env: FlowEnv;
  let runner: typeof import('../../src/server/services/jobRunner').jobRunner;

  beforeAll(async () => {
    process.env.CROSSLISTER_IMPORT_DELAY_MS = '0';
    env = await startFlowEnv();
    t = await createTestApp();
    runner = (await import('../../src/server/services/jobRunner')).jobRunner;
  });
  afterAll(async () => { await resetBrowser('poshmark'); await t.cleanup(); await env.close(); });
  beforeEach(async () => {
    await resetBrowser('poshmark');
    setOverrides(env.fixtureUrl, 'poshmark', { login: '/poshmark/login.html', home: '/poshmark/closet.html', sell: '/poshmark/sell.html' });
  });

  it('asks the user to open their closet, scans while scrolling, then reads a listing via JSON-LD', async () => {
    await fakeLogin('poshmark', env.fixtureUrl);
    const { batch, job } = (await req(t.app, 'POST', '/api/import/batches', { marketplaceId: 'poshmark', method: 'shop_page' })).json();
    const run = runner.runOnce(t.db);
    await waitFor(async () => (await req(t.app, 'GET', `/api/jobs/${job.id}`)).json().state === 'NEEDS_USER', 15_000);
    await req(t.app, 'POST', `/api/jobs/${job.id}/continue`, {});
    await run;
    const scanned = (await req(t.app, 'GET', `/api/import/batches/${batch.id}`)).json();
    expect(scanned.batch.state).toBe('ready');
    expect(scanned.items.map((i: { remoteId: string }) => i.remoteId).sort()).toEqual(['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)]);
    const blue = scanned.items.find((i: { remoteId: string }) => i.remoteId === 'a'.repeat(24));
    expect(blue.title).toBe('Blue jacket');
    expect(blue.url).not.toContain('?');

    await req(t.app, 'POST', `/api/import/batches/${batch.id}/fetch`, { itemIds: [blue.id] });
    await runner.runOnce(t.db);
    const fetched = (await req(t.app, 'GET', `/api/import/batches/${batch.id}`)).json();
    const item = fetched.items.find((i: { id: string }) => i.id === blue.id);
    expect(item.state, item.error).toBe('fetched');
    expect(item.mapped).toMatchObject({ title: 'Blue jacket', priceCents: 5500, brand: 'Patagonia', size: 'M' });
  });
});
