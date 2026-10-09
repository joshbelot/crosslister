import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fakeAdapter } from '../helpers/fakeAdapter';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';
import { __setAdaptersForTest, allAdapters } from '../../src/server/marketplaces/registry';
import { jobRunner } from '../../src/server/services/jobRunner';

let t: TestApp;
const real = allAdapters();
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { __setAdaptersForTest(null); await t.cleanup(); });
afterEach(async () => { await jobRunner.idle(); __setAdaptersForTest(real); });

describe('update route', () => {
  it('409 NOT_ACTIVE unless live; 409 UPDATE_UNSUPPORTED when the adapter cannot update; otherwise runs adapter.update', async () => {
    const seen: string[] = [];
    __setAdaptersForTest([
      fakeAdapter('vinted', { update: async (_ctx, l) => { seen.push(l.title); } }),
      fakeAdapter('offerup', { caps: { update: 'none' } }),
      ...real.filter((a) => !['vinted', 'offerup'].includes(a.id)),
    ]);
    const l = await seedListing(t.app, { title: 'Original' });
    const notActive = await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/update`);
    expect(notActive.statusCode).toBe(404); // no target yet
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/mark-listed`, {});
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/offerup/mark-listed`, {});
    const unsupported = await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/offerup/update`);
    expect(unsupported.statusCode).toBe(409);
    expect(unsupported.json().error.code).toBe('UPDATE_UNSUPPORTED');
    await req(t.app, 'PATCH', `/api/listings/${l.id}`, { title: 'Edited' });
    const ok = await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/update`);
    expect(ok.statusCode).toBe(200);
    await jobRunner.runOnce(t.db);
    expect(seen).toEqual(['Edited']);
    expect((await req(t.app, 'GET', `/api/jobs/${ok.json().job.id}`)).json().state).toBe('SUCCESS');
    await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/mark-ended`);
    expect((await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/vinted/update`)).json().error.code).toBe('NOT_ACTIVE');
  });
});
