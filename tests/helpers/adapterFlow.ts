import fs from 'node:fs';
import type { MarketplaceId } from '../../src/shared/constants';
import { startFixtureServer } from '../../src/server/scripts/fixtureServer';
import { req, type TestApp } from './testApp';

export interface FlowEnv { fixtureUrl: string; close(): Promise<void> }

/** Starts the fixture server and points CROSSLISTER_URL_OVERRIDES at it. */
export async function startFlowEnv(): Promise<FlowEnv> {
  const server = await startFixtureServer(0);
  process.env.CROSSLISTER_HEADLESS = '1';
  return { fixtureUrl: server.url, async close() { await server.close(); delete process.env.CROSSLISTER_URL_OVERRIDES; } };
}

export function setOverrides(fixtureUrl: string, mp: MarketplaceId, urls: Record<string, string>): void {
  const abs = Object.fromEntries(Object.entries(urls).map(([k, v]) => [k, v.startsWith('http') ? v : `${fixtureUrl}${v}`]));
  process.env.CROSSLISTER_URL_OVERRIDES = JSON.stringify({ [mp]: abs });
}

/** Close the marketplace browser and delete its profile so each test starts logged out with empty storage. */
export async function resetBrowser(mp: MarketplaceId): Promise<void> {
  const { browserManager } = await import('../../src/server/browser/browserManager');
  const { profileDir } = await import('../../src/server/paths');
  await browserManager.close(mp);
  fs.rmSync(profileDir(mp), { recursive: true, force: true });
}

/** Simulate an already-logged-in browser for the fixture origin. */
export async function fakeLogin(mp: MarketplaceId, fixtureUrl: string): Promise<void> {
  const { browserManager } = await import('../../src/server/browser/browserManager');
  const page = await browserManager.getPage(mp);
  await page.goto(`${fixtureUrl}/_helpers/helpers.html`);
  await page.evaluate(() => localStorage.setItem('cl-login', '1'));
}

export async function setAutoSubmit(app: TestApp['app'], mp: MarketplaceId, on: boolean): Promise<void> {
  const s = (await req(app, 'GET', '/api/settings')).json();
  s.marketplaces[mp].autoSubmit = on;
  s.marketplaces[mp].dailyLimit = 200;
  await req(app, 'PUT', '/api/settings', s);
}

export async function readFilled(mp: MarketplaceId): Promise<Record<string, unknown>> {
  const { browserManager } = await import('../../src/server/browser/browserManager');
  const page = await browserManager.getPage(mp);
  return page.evaluate(() => JSON.parse(localStorage.getItem('cl-filled') ?? '{}'));
}
