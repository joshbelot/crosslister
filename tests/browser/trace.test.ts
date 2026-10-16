import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '../helpers/fakeAdapter';
import { fakeLogin, resetBrowser, setAutoSubmit, setOverrides, startFlowEnv, type FlowEnv } from '../helpers/adapterFlow';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('job traces (mercari fixtures)', () => {
  let t: TestApp;
  let env: FlowEnv;
  let runner: typeof import('../../src/server/services/jobRunner').jobRunner;
  const job = async (id: string) => (await req(t.app, 'GET', `/api/jobs/${id}`)).json();

  beforeAll(async () => { env = await startFlowEnv(); t = await createTestApp(); runner = (await import('../../src/server/services/jobRunner')).jobRunner; });
  afterAll(async () => { await resetBrowser('mercari'); await t.cleanup(); await env.close(); });
  beforeEach(async () => { await resetBrowser('mercari'); });

  it('records locators, fills, snapshots and a report for a step that needed the user', async () => {
    const { traceDir } = await import('../../src/server/paths');
    const { sel } = await import('../../src/server/marketplaces/mercari/selectors');
    await setAutoSubmit(t.app, 'mercari', true);
    setOverrides(env.fixtureUrl, 'mercari', { sell: '/mercari/sell.html?missing=brand', login: '/mercari/login.html', home: '/mercari/sell.html' });
    await fakeLogin('mercari', env.fixtureUrl);
    const l = await seedListing(t.app, { brand: "Levi's" });
    const jobId = (await req(t.app, 'POST', `/api/listings/${l.id}/crosslist`, { marketplaceIds: ['mercari'] })).json().jobs[0].id as string;
    const run = runner.runOnce(t.db);
    await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    await req(t.app, 'POST', `/api/jobs/${jobId}/continue`, { url: 'https://www.mercari.com/us/item/m99999999999/' });
    await run;

    const dir = traceDir(jobId);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    expect(meta.state).toBe('SUCCESS');
    expect(meta.missingFields).toContain('Selecting brand');

    const events = fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    const miss = events.find((e) => e.kind === 'locator' && e.ok === false && e.what === sel.brand.what);
    expect(miss).toBeTruthy();
    expect(miss.candidates).toHaveLength(sel.brand.candidates.length);
    expect(events.some((e) => e.kind === 'fill' && e.ok === true && /title/i.test(e.what))).toBe(true);

    const snaps = fs.readdirSync(path.join(dir, 'snapshots'));
    for (const ext of ['png', 'html', 'controls.json']) expect(snaps.some((f) => f.includes('-brand-needs_user.') && f.endsWith(`.${ext}`))).toBe(true);

    const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
    expect(report).toContain('NOT FOUND');
    expect(report).toContain(sel.brand.what);
  }, 120_000);
});
