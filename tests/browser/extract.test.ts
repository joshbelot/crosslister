import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractProduct } from '../../src/server/browser/extract';
import { startBrowserEnv, type BrowserEnv } from '../helpers/browser';

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('extractProduct (browser)', () => {
  let env: BrowserEnv;
  beforeAll(async () => { env = await startBrowserEnv(); });
  afterAll(async () => { await env.close(); });

  it('extracts a product from a live page and merges adapter extras', async () => {
    await env.page.goto(`${env.fixtureUrl}/_import/product-jsonld.html`);
    const x = await extractProduct(env.page, async () => ({ size: 'XL', category: ['Extra'] }));
    expect(x.title).toBe("Vintage Levi's trucker jacket");
    expect(x.size).toBe('M'); // JSON-LD wins over adapter extras
    expect(x.images[1]).toBe(`${env.fixtureUrl}/2.jpg`);
  });
});
