import { chromium, type Browser, type Page } from 'playwright';
import { startFixtureServer } from '../../src/server/scripts/fixtureServer';

export interface BrowserEnv { browser: Browser; page: Page; fixtureUrl: string; close(): Promise<void> }

/** Launch headless Chromium (CROSSLISTER_CHROMIUM_PATH overrides the browser binary) and the fixture server. */
export async function startBrowserEnv(): Promise<BrowserEnv> {
  const server = await startFixtureServer(0);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CROSSLISTER_CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  return { browser, page, fixtureUrl: server.url, async close() { await browser.close(); await server.close(); } };
}

/** Minimal JobContext stand-in for helpers that need `ctx.sleep`. */
export function fakeCtx(): import('../../src/server/services/jobContext').JobContext {
  return { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 20))) } as never;
}
