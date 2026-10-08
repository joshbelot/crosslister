import { chromium, type BrowserContext, type Page } from 'playwright';
import type { MarketplaceId } from '../../shared/constants';
import type { Db } from '../db/client';
import { profileDir } from '../paths';
import { getSettings } from '../services/settings';
import { logger } from '../services/logger';

let db: Db | null = null;
const contexts = new Map<MarketplaceId, Promise<BrowserContext>>();
const idleTimers = new Map<MarketplaceId, NodeJS.Timeout>();
const closedHandlers: Array<(mp: MarketplaceId) => void> = [];

export function initBrowserManager(database: Db): void { db = database; }

/** Register a callback fired when a marketplace's browser window/context closes by itself. */
export function onContextClosed(fn: (mp: MarketplaceId) => void): void { closedHandlers.push(fn); }

function clearIdle(mp: MarketplaceId): void {
  const t = idleTimers.get(mp);
  if (t) { clearTimeout(t); idleTimers.delete(mp); }
}

async function launch(mp: MarketplaceId): Promise<BrowserContext> {
  const settings = db ? getSettings(db) : null;
  const headless = process.env.CROSSLISTER_HEADLESS === '1';
  const base = {
    headless,
    viewport: null,
    slowMo: settings?.browser.slowMoMs ?? 0,
    acceptDownloads: false,
    args: ['--window-size=1280,900'],
  };
  // Forbidden here: stealth plugins, hiding automation flags, user-agent spoofing, proxies.
  const wantChrome = (settings?.browser.channel ?? 'chrome') === 'chrome' && !headless;
  let context: BrowserContext;
  if (wantChrome) {
    try {
      context = await chromium.launchPersistentContext(profileDir(mp), { ...base, channel: 'chrome' });
    } catch (err) {
      logger.warn('BROWSER', `Google Chrome not found, using Playwright Chromium (${(err as Error).message.split('\n')[0]})`);
      context = await chromium.launchPersistentContext(profileDir(mp), base);
    }
  } else {
    context = await chromium.launchPersistentContext(profileDir(mp), base);
  }
  context.on('close', () => {
    contexts.delete(mp);
    clearIdle(mp);
    for (const fn of closedHandlers) fn(mp);
  });
  return context;
}

export const browserManager = {
  getContext(mp: MarketplaceId): Promise<BrowserContext> {
    clearIdle(mp);
    let p = contexts.get(mp);
    if (!p) {
      p = launch(mp);
      contexts.set(mp, p);
      p.catch(() => contexts.delete(mp));
    }
    return p;
  },
  async getPage(mp: MarketplaceId): Promise<Page> {
    const ctx = await this.getContext(mp);
    return ctx.pages()[0] ?? (await ctx.newPage());
  },
  hasPage(mp: MarketplaceId): boolean {
    return contexts.has(mp);
  },
  /** The current page without launching anything (undefined if no window is open). */
  async peekPage(mp: MarketplaceId): Promise<Page | undefined> {
    const p = contexts.get(mp);
    if (!p) return undefined;
    try { return (await p).pages()[0]; } catch { return undefined; }
  },
  async close(mp: MarketplaceId): Promise<void> {
    clearIdle(mp);
    const p = contexts.get(mp);
    if (!p) return;
    contexts.delete(mp);
    try { await (await p).close(); } catch { /* already closed */ }
  },
  async closeAll(): Promise<void> {
    await Promise.all([...contexts.keys()].map((mp) => this.close(mp)));
  },
  markIdle(mp: MarketplaceId): void {
    if (!contexts.has(mp)) return;
    clearIdle(mp);
    const minutes = db ? getSettings(db).browser.closeIdleMinutes : 20;
    const t = setTimeout(() => { void this.close(mp); }, minutes * 60_000);
    t.unref();
    idleTimers.set(mp, t);
  },
};
