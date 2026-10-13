import net from 'node:net';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitFor } from '../helpers/fakeAdapter';

const ENV = ['CROSSLISTER_BROWSER_MODE', 'CROSSLISTER_CHROME_PATH', 'CROSSLISTER_CHROME_HEADLESS', 'CROSSLISTER_CDP_PORT'] as const;

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address() as net.AddressInfo;
    s.close(() => resolve(port));
  });
});

describe.skipIf(!process.env.RUN_BROWSER_TESTS)('browser manager — attach mode (one shared Chrome)', () => {
  const saved: Record<string, string | undefined> = {};
  let bm: typeof import('../../src/server/browser/browserManager');

  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.CROSSLISTER_BROWSER_MODE = 'attach';
    process.env.CROSSLISTER_CHROME_PATH = process.env.CROSSLISTER_CHROMIUM_PATH || chromium.executablePath();
    process.env.CROSSLISTER_CHROME_HEADLESS = '1';
    process.env.CROSSLISTER_CDP_PORT = String(await freePort());
    bm = await import('../../src/server/browser/browserManager');
  });

  afterAll(async () => {
    await bm.browserManager.quitShared();
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it('opens one tab per marketplace in the same Chrome', async () => {
    const a = await bm.browserManager.getPage('mercari');
    const b = await bm.browserManager.getPage('depop');
    expect(a).not.toBe(b);
    expect(a.context()).toBe(b.context());
    expect(await bm.browserManager.getPage('mercari')).toBe(a);
    expect(bm.browserManager.hasPage('mercari')).toBe(true);
  }, 60_000);

  it('reports a closed tab and opens a new one on the next request', async () => {
    const closed: string[] = [];
    bm.onContextClosed((mp) => closed.push(mp));
    const a = await bm.browserManager.getPage('mercari');
    await a.close();
    await waitFor(async () => (closed.includes('mercari') ? true : null), 10_000);
    expect(bm.browserManager.hasPage('mercari')).toBe(false);
    const again = await bm.browserManager.getPage('mercari');
    expect(again).not.toBe(a);
    expect(again.isClosed()).toBe(false);
  }, 60_000);

  it('keeps logins across a Chrome restart and logs out one site at a time', async () => {
    const expires = Math.floor(Date.now() / 1000) + 86_400;
    const ctx1 = await bm.browserManager.getContext('mercari');
    await ctx1.addCookies([
      { name: 'session', value: '1', domain: '.example.com', path: '/', expires },
      { name: 'session', value: '2', domain: '.example.org', path: '/', expires },
    ]);
    await bm.browserManager.quitShared();

    const ctx2 = await bm.browserManager.getContext('mercari');
    const domains = async () => (await ctx2.cookies(['https://www.example.com/', 'https://www.example.org/'])).map((c) => c.domain).sort();
    expect(await domains()).toEqual(['.example.com', '.example.org']);

    await bm.browserManager.clearSiteCookies(['example.com']);
    expect(await domains()).toEqual(['.example.org']);
  }, 90_000);
});
