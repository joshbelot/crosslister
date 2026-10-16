import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { MarketplaceId } from '../../shared/constants';
import type { Db } from '../db/client';
import { adapterError } from '../marketplaces/adapterError';
import { paths, profileDir } from '../paths';
import { getSettings } from '../services/settings';
import { logger } from '../services/logger';

let db: Db | null = null;
const idleTimers = new Map<MarketplaceId, NodeJS.Timeout>();
const closedHandlers: Array<(mp: MarketplaceId) => void> = [];

export function initBrowserManager(database: Db): void { db = database; }

/** Register a callback fired when a marketplace's browser tab/window closes by itself. */
export function onContextClosed(fn: (mp: MarketplaceId) => void): void { closedHandlers.push(fn); }

function clearIdle(mp: MarketplaceId): void {
  const t = idleTimers.get(mp);
  if (t) { clearTimeout(t); idleTimers.delete(mp); }
}

const fireClosed = (mp: MarketplaceId): void => { clearIdle(mp); for (const fn of closedHandlers) fn(mp); };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------------------------

export type BrowserMode = 'attach' | 'launch';

/** `attach` = one real Chrome shared by all marketplaces (13 §1); `launch` = one Playwright-launched context per marketplace (tests). */
export function browserMode(): BrowserMode {
  const forced = process.env.CROSSLISTER_BROWSER_MODE;
  if (forced === 'attach' || forced === 'launch') return forced;
  return process.env.CROSSLISTER_HEADLESS === '1' || process.env.CROSSLISTER_CHROMIUM_PATH ? 'launch' : 'attach';
}

// ---------------------------------------------------------------------------------------------
// Attach mode: the app starts the installed Chrome as a normal process and connects to it.
// ---------------------------------------------------------------------------------------------

export const sharedProfileDir = (): string => path.join(paths.profilesDir, 'chrome');
const cdpPort = (): number => Number(process.env.CROSSLISTER_CDP_PORT ?? 9333);

export function chromeCandidates(platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
  }
  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
}

export function findChrome(): string | null {
  const override = process.env.CROSSLISTER_CHROME_PATH;
  if (override) return fs.existsSync(override) ? override : null;
  return chromeCandidates().find((p) => fs.existsSync(p)) ?? null;
}

/**
 * The complete list of switches the app passes to Chrome. Do not add to it.
 * Forbidden here: anything that hides automation, user-agent overrides, proxies, extensions.
 */
export function chromeArgs(userDataDir: string, port: number): string[] {
  const args = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
  ];
  if (process.env.CROSSLISTER_CHROME_HEADLESS === '1') args.push('--headless=new');
  args.push('about:blank');
  return args;
}

async function cdpAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { Browser?: unknown };
    return typeof body.Browser === 'string';
  } catch {
    return false;
  }
}

let shared: Promise<Browser> | null = null;
const pages = new Map<MarketplaceId, Page>();
const pendingPages = new Map<MarketplaceId, Promise<Page>>();

async function startShared(): Promise<Browser> {
  const port = cdpPort();
  if (!(await cdpAlive(port))) {
    const exe = findChrome();
    if (!exe) throw adapterError('CHROME_NOT_FOUND', null);
    fs.mkdirSync(sharedProfileDir(), { recursive: true });
    // detached + unref: Chrome keeps running (and stays logged in) when the app restarts.
    const child = spawn(exe, chromeArgs(sharedProfileDir(), port), { detached: true, stdio: 'ignore' });
    child.on('error', (err) => logger.warn('BROWSER', `Could not start Google Chrome: ${err.message}`));
    child.unref();
    const deadline = Date.now() + 20_000;
    while (!(await cdpAlive(port))) {
      if (Date.now() > deadline) throw adapterError('BROWSER_START_FAILED', null);
      await sleep(250);
    }
    logger.info('BROWSER', `Started Google Chrome (profile ${sharedProfileDir()}, port ${port})`);
  }
  const settings = db ? getSettings(db) : null;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { slowMo: settings?.browser.slowMoMs ?? 0 });
  browser.on('disconnected', () => {
    shared = null;
    const open = [...pages.keys()];
    pages.clear();
    for (const mp of open) fireClosed(mp);
  });
  return browser;
}

function getShared(): Promise<Browser> {
  if (!shared) {
    const p = startShared();
    shared = p;
    p.catch(() => { if (shared === p) shared = null; });
  }
  return shared;
}

async function sharedContext(): Promise<BrowserContext> {
  const context = (await getShared()).contexts()[0];
  if (!context) throw adapterError('BROWSER_START_FAILED', null);
  return context;
}

async function openTab(mp: MarketplaceId): Promise<Page> {
  const context = await sharedContext();
  // Reuse the blank tab Chrome opens at startup instead of leaving it behind. No `await` between find and set.
  const taken = new Set(pages.values());
  const blank = context.pages().find((p) => p.url() === 'about:blank' && !taken.has(p));
  const page = blank ?? (await context.newPage());
  pages.set(mp, page);
  page.on('close', () => {
    if (pages.get(mp) !== page) return;
    pages.delete(mp);
    fireClosed(mp);
  });
  return page;
}

function attachPage(mp: MarketplaceId): Promise<Page> {
  const existing = pages.get(mp);
  if (existing && !existing.isClosed()) return Promise.resolve(existing);
  let p = pendingPages.get(mp);
  if (!p) {
    p = openTab(mp).finally(() => pendingPages.delete(mp));
    pendingPages.set(mp, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Launch mode (tests): one Playwright-launched persistent context per marketplace. Unchanged from round 1.
// ---------------------------------------------------------------------------------------------

const contexts = new Map<MarketplaceId, Promise<BrowserContext>>();

async function launch(mp: MarketplaceId): Promise<BrowserContext> {
  const settings = db ? getSettings(db) : null;
  const headless = process.env.CROSSLISTER_HEADLESS === '1';
  // CROSSLISTER_CHROMIUM_PATH: advanced/test override for the browser binary (e.g. a Chromium that matches Playwright).
  const executablePath = process.env.CROSSLISTER_CHROMIUM_PATH || undefined;
  const base = {
    headless,
    ...(executablePath ? { executablePath } : {}),
    viewport: null,
    slowMo: settings?.browser.slowMoMs ?? 0,
    acceptDownloads: false,
    args: ['--window-size=1280,900'],
  };
  // Forbidden here: stealth plugins, hiding automation flags, user-agent spoofing, proxies.
  const wantChrome = (settings?.browser.channel ?? 'chrome') === 'chrome' && !headless && !executablePath;
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
    fireClosed(mp);
  });
  return context;
}

function launchContext(mp: MarketplaceId): Promise<BrowserContext> {
  let p = contexts.get(mp);
  if (!p) {
    p = launch(mp);
    contexts.set(mp, p);
    p.catch(() => contexts.delete(mp));
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export const browserManager = {
  getContext(mp: MarketplaceId): Promise<BrowserContext> {
    clearIdle(mp);
    return browserMode() === 'attach' ? sharedContext() : launchContext(mp);
  },
  async getPage(mp: MarketplaceId): Promise<Page> {
    clearIdle(mp);
    if (browserMode() === 'attach') return attachPage(mp);
    const ctx = await launchContext(mp);
    return ctx.pages()[0] ?? (await ctx.newPage());
  },
  hasPage(mp: MarketplaceId): boolean {
    return browserMode() === 'attach' ? pages.has(mp) : contexts.has(mp);
  },
  /** The current page without launching anything (undefined if no tab/window is open). */
  async peekPage(mp: MarketplaceId): Promise<Page | undefined> {
    if (browserMode() === 'attach') {
      const page = pages.get(mp);
      return page && !page.isClosed() ? page : undefined;
    }
    const p = contexts.get(mp);
    if (!p) return undefined;
    try { return (await p).pages()[0]; } catch { return undefined; }
  },
  /** Attach mode: close this marketplace's tab (Chrome keeps running). Launch mode: close its window. */
  async close(mp: MarketplaceId): Promise<void> {
    clearIdle(mp);
    if (browserMode() === 'attach') {
      const page = pages.get(mp);
      if (!page) return;
      try { await page.close(); } catch { /* already closed */ }
      pages.delete(mp);
      return;
    }
    const p = contexts.get(mp);
    if (!p) return;
    contexts.delete(mp);
    try { await (await p).close(); } catch { /* already closed */ }
  },
  /** App shutdown. Attach mode closes the app's tabs and disconnects; Chrome itself stays open so logins and windows survive. */
  async closeAll(): Promise<void> {
    await Promise.all([...contexts.keys()].map((mp) => this.close(mp)));
    if (browserMode() !== 'attach') return;
    for (const mp of [...pages.keys()]) await this.close(mp);
    const p = shared;
    shared = null;
    if (p) { try { await (await p).close(); } catch { /* not connected */ } }
  },
  markIdle(mp: MarketplaceId): void {
    if (!this.hasPage(mp)) return;
    clearIdle(mp);
    const minutes = db ? getSettings(db).browser.closeIdleMinutes : 20;
    const t = setTimeout(() => { void this.close(mp); }, minutes * 60_000);
    t.unref();
    idleTimers.set(mp, t);
  },
  /** A tab for background work (status checks) that is not the marketplace's main tab. Attach mode: a new tab, closed with closeTempPage. Launch mode: the marketplace's page. */
  async openTempPage(mp: MarketplaceId): Promise<Page> {
    if (browserMode() !== 'attach') return this.getPage(mp);
    const page = await (await sharedContext()).newPage();
    return page;
  },
  async closeTempPage(page: Page): Promise<void> {
    if (browserMode() !== 'attach') return;
    try { await page.close(); } catch { /* already closed */ }
  },
  /** Attach mode only: delete the cookies of the given sites (host suffixes such as `depop.com`) so the user is logged out there. */
  async clearSiteCookies(hosts: string[]): Promise<void> {
    if (browserMode() !== 'attach' || hosts.length === 0) return;
    const context = await sharedContext();
    for (const h of hosts) {
      await context.clearCookies({ domain: new RegExp(`(^|\\.)${h.replace(/\./g, '\\.')}$`) });
    }
  },
  /** Tests only: really quit the shared Chrome and wait until its profile is released. */
  async quitShared(): Promise<void> {
    const p = shared;
    if (!p) return;
    try {
      const browser = await p;
      const session = await browser.newBrowserCDPSession();
      await session.send('Browser.close');
    } catch { /* already gone */ }
    shared = null;
    pages.clear();
    const lock = path.join(sharedProfileDir(), 'SingletonLock');
    const deadline = Date.now() + 10_000;
    for (;;) {
      let locked = true;
      try { fs.lstatSync(lock); } catch { locked = false; }
      if ((!locked && !(await cdpAlive(cdpPort()))) || Date.now() > deadline) break;
      await sleep(200);
    }
  },
};
