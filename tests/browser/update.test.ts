import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MarketplaceId } from '../../src/shared/constants';
import { fakeLogin, resetBrowser, setAutoSubmit, setOverrides, startFlowEnv, type FlowEnv } from '../helpers/adapterFlow';
import { seedListing } from '../helpers/fixtures';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

interface Case { mp: MarketplaceId; editPath: string; url: string; button: string; auto: boolean; expected: Record<string, string> }
const CASES: Case[] = [
  { mp: 'mercari', editPath: '/mercari/sell/edit/{id}/', url: 'https://www.mercari.com/us/item/m12345678901/', button: 'Update', auto: true, expected: { title: 'New title', price: '70.00' } },
  { mp: 'poshmark', editPath: '/poshmark/edit-listing/{id}', url: 'https://poshmark.com/listing/x-0123456789abcdef01234567', button: 'Update', auto: true, expected: { title: 'New title', price: '70' } },
  { mp: 'depop', editPath: '/depop/products/edit/{id}/', url: 'https://www.depop.com/products/vintage-levis-jeans-abc/', button: 'Save', auto: true, expected: { price: '70.00' } },
  { mp: 'facebook', editPath: '/facebook/marketplace/edit/?listing_id={id}', url: 'https://www.facebook.com/marketplace/item/1234567890123456/', button: 'Update', auto: false, expected: { title: 'New title', price: '70' } },
  { mp: 'grailed', editPath: '/grailed/listings/{id}/edit', url: 'https://www.grailed.com/listings/1234567-x', button: 'Save', auto: true, expected: { title: 'New title', price: '70' } },
];

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('update live listings (fixtures)', () => {
  let t: TestApp;
  let env: FlowEnv;
  let runner: typeof import('../../src/server/services/jobRunner').jobRunner;
  beforeAll(async () => { env = await startFlowEnv(); t = await createTestApp(); runner = (await import('../../src/server/services/jobRunner')).jobRunner; });
  afterAll(async () => { for (const c of CASES) await resetBrowser(c.mp); await t.cleanup(); await env.close(); });
  const job = async (id: string) => (await req(t.app, 'GET', `/api/jobs/${id}`)).json();

  for (const c of CASES) {
    describe(c.mp, () => {
      beforeEach(async () => {
        await resetBrowser(c.mp);
        setOverrides(env.fixtureUrl, c.mp, { sell: `/${c.mp}/sell.html`, login: `/${c.mp}/login.html`, home: `/${c.mp}/sell.html`, edit: c.editPath });
      });

      it('pushes title, description and price to the edit page and saves', async () => {
        await setAutoSubmit(t.app, c.mp, c.auto);
        await fakeLogin(c.mp, env.fixtureUrl);
        const l = await seedListing(t.app, { brand: "Levi's", tags: ['vintage'] });
        await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/${c.mp}/mark-listed`, { url: c.url });
        await req(t.app, 'PATCH', `/api/listings/${l.id}`, { title: 'New title', description: 'New description text', priceCents: 7000 });
        const { job: uj } = (await req(t.app, 'POST', `/api/listings/${l.id}/marketplaces/${c.mp}/update`)).json();
        const run = runner.runOnce(t.db);
        if (!c.auto) {
          let waiting;
          for (let i = 0; i < 600 && !waiting; i++) { const j = await job(uj.id); if (j.state === 'NEEDS_USER') waiting = j; else if (['FAILED', 'SUCCESS'].includes(j.state)) throw new Error(`ended early ${j.state} ${j.errorMessage}`); else await new Promise((r) => setTimeout(r, 100)); }
          expect(waiting.needsUser.title).toBe(`Review and save on ${c.mp === 'facebook' ? 'Facebook Marketplace' : c.mp}`);
          const { browserManager } = await import('../../src/server/browser/browserManager');
          await (await browserManager.getPage(c.mp)).getByRole('button', { name: c.button, exact: true }).click();
        }
        await run;
        const j = await job(uj.id);
        expect(j.state, j.errorMessage).toBe('SUCCESS');
        const { browserManager } = await import('../../src/server/browser/browserManager');
        const edit = JSON.parse((await (await browserManager.getPage(c.mp)).evaluate(() => localStorage.getItem('cl-edit'))) ?? '{}');
        expect(edit).toMatchObject(c.expected);
        expect(String(edit.description)).toContain('New description text');
        const stepKeys = j.steps.map((s: { key: string }) => s.key);
        expect(stepKeys).toEqual(expect.arrayContaining(['photos', 'open', 'login', 'price']));
        expect(stepKeys).not.toContain('category');
        const d = (await req(t.app, 'GET', `/api/listings/${l.id}`)).json();
        expect(d.marketplaces[0].status).toBe('active');
        expect(d.marketplaces[0].lastSyncedAt).toBeTruthy();
      }, 120_000);
    });
  }
});
