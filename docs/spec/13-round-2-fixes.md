# 13 — Round 2: bug fixes after first real use

Round 1 (M1–M39) is complete. This file is the build plan for the fixes found when the app was first run on the user's Mac (2026-10-13). Same rules as `README.md` in this folder: follow it literally, work milestone by milestone (M40 → M43), run `npm run typecheck && npm test` after each, commit as `M<n>: <title>`.

**Do not make design decisions.** Every file, function name, message string and test below is given. If something here does not compile against the installed library version, keep the described behavior, adapt the call, and add one line under "Decisions made during implementation" in `IMPLEMENTATION_SUMMARY.md`.

## 0. What was found

| # | Problem | Cause | Fixed in |
|---|---|---|---|
| 1 | Connecting a marketplace opens a blank, logged-out browser window that looks like incognito. Logins from the user's normal browser are not there, and each marketplace gets its own separate window. | `browserManager` calls `chromium.launchPersistentContext(profileDir(mp))` — one empty Playwright-launched profile per marketplace. | M40 |
| 2 | Depop shows an error page ("there was a problem…") instead of loading. `https://www.depop.com/login/` and `/products/create/` load fine in a normal browser, so the URLs are right. | Depop refuses browsers that Playwright launches (they carry Chrome's automation switch). "Continue with Google" is refused in such browsers too. | M40 (and M41 §2.3 for a clear message when a site still refuses) |
| 3 | If a marketplace's "logged-in indicator" selector is wrong (all of them are uncalibrated), a job can never get past login: the app sends a logged-in user to the login page, and after they click **I'm logged in** it fails with "You're not logged in". | `ensureLoggedIn` in `src/server/marketplaces/common.ts` trusts only the indicator selector. | M41 |
| 4 | Any page containing the word "verified" (e.g. a "Verified seller" badge) pauses the job with "needs you to verify it's you". | `challenge` selectors use `/verify|…/i`, which matches "verified". | M41 |
| 5 | Typing `http://localhost:5173/listings/new` shows "That listing was not found." | Only `/new` and `/listings/new/edit` are routed. | M42 |
| 6 | Cross-listing validation shows "✗ Missing information" and "No issues." on the same marketplace row when the only problems are the global ones at the top. | `CrosslistFlow.tsx` prints "No issues." whenever the row has no issues of its own. | M42 |
| 7 | Depop's parcel-size step always falls back to the user when the listing has no package weight, with no warning beforehand. | `depopAdapter.validate` does not mention weight. | M42 |

### Decision recorded (user, 2026-10-13)

Browser marketplaces now run in **one normal Google Chrome window that the app starts itself** (the installed Chrome, started as an ordinary process with its own profile folder and a local debugging port), and the app attaches to it. All marketplaces are tabs in that one window; the user logs in once per site and stays logged in.

This replaces "Playwright launches the browser" for real use. It is the **only** change to the automation rules. Still forbidden, with no exceptions: stealth or fingerprint plugins, `--disable-blink-features=AutomationControlled` or any other flag whose purpose is hiding automation, user-agent overrides, `navigator.webdriver` overrides, script injection to alter browser properties, CAPTCHA solving, credential autofill, proxies. The complete list of Chrome switches the app may pass is in §1.2 — do not add to it.

---

## 1. M40 — One shared Chrome window

### 1.1 Two modes

`browserManager` gets two modes, chosen per call by `browserMode()`:

| Mode | When | Behavior |
|---|---|---|
| `attach` | Default for real use. | One real Chrome, one profile at `browser-profiles/chrome/`, one tab per marketplace. New code. |
| `launch` | `CROSSLISTER_HEADLESS=1`, or `CROSSLISTER_CHROMIUM_PATH` is set, or `CROSSLISTER_BROWSER_MODE=launch`. Used by every existing test. | Exactly today's behavior (one Playwright-launched persistent context per marketplace). Existing code, unchanged. |

New environment variables (all optional):

| Variable | Meaning |
|---|---|
| `CROSSLISTER_BROWSER_MODE` | `attach` or `launch`; overrides the automatic choice. |
| `CROSSLISTER_CHROME_PATH` | Full path to the Chrome binary for attach mode. |
| `CROSSLISTER_CDP_PORT` | Local debugging port for attach mode. Default `9333`. |
| `CROSSLISTER_CHROME_HEADLESS` | `1` adds `--headless=new` in attach mode. Tests only. |

Add the first three to `.env.example` as commented-out lines under the `# Server` block, exactly:

```bash
# Browser (optional). The app starts your installed Google Chrome with its own profile and attaches to it.
# CROSSLISTER_CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
# CROSSLISTER_CDP_PORT=9333
# CROSSLISTER_BROWSER_MODE=attach    # attach (default) | launch (Playwright-launched, one window per marketplace)
```

### 1.2 Replace `src/server/browser/browserManager.ts` with this file

```ts
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
```

Notes for the implementer (no action needed, just so the code is not "simplified" away):

- `browser.close()` on a browser obtained from `connectOverCDP` only disconnects; it does not quit Chrome. That is intended.
- `spawn(..., { detached: true })` + `unref()` is intended: `npm run dev` restarts the server on every file change and Chrome must survive that.
- Tabs left over from before an app restart are not adopted; the app opens new tabs. That is intended.
- If `context.clearCookies({ domain: RegExp })` is not accepted by the installed Playwright, replace the loop body with: read `await context.cookies()`, keep the ones whose `domain` matches the same RegExp, and call `context.clearCookies({ name: c.name, domain: c.domain, path: c.path })` for each.

### 1.3 Error codes — `src/server/marketplaces/adapterError.ts`

1. Add `'CHROME_NOT_FOUND' | 'BROWSER_START_FAILED'` to the `AdapterErrorCode` union (put them right after `'BROWSER_CLOSED'`).
2. Add to the `switch` in `errorMessage`, right after the `BROWSER_CLOSED` case:

```ts
    case 'CHROME_NOT_FOUND': return 'Google Chrome is not installed. Install it from google.com/chrome, then try again.';
    case 'BROWSER_START_FAILED': return "Couldn't start Google Chrome for Crosslister. Quit the Chrome window that Crosslister opened (if any) and try again.";
```

3. Change the `BROWSER_CLOSED` message to: `` `The ${N} tab or the browser window was closed before the job finished.` ``
4. Run `grep -rn "browser window was closed" tests src` and update every expected string in tests to the new sentence.

### 1.4 Test environment — `tests/helpers/setupEnv.ts`

Append this line at the end of the file (unit tests must never start the user's real Chrome):

```ts
process.env.CROSSLISTER_BROWSER_MODE = 'launch';
```

### 1.5 Adapter hosts — `src/server/marketplaces/types.ts` and the five browser adapters

1. In `interface BrowserAdapter`, add after the `kind: 'browser';` line:

```ts
  hosts: string[];                                // host suffixes of the marketplace's own site, e.g. ['depop.com']
```

2. In each adapter object, add one line directly after its `kind: 'browser',` line:

| File | Line to add |
|---|---|
| `src/server/marketplaces/mercari/index.ts` | `hosts: MERCARI_HOSTS,` |
| `src/server/marketplaces/poshmark/index.ts` | `hosts: POSHMARK_HOSTS,` |
| `src/server/marketplaces/depop/index.ts` | `hosts: DEPOP_HOSTS,` |
| `src/server/marketplaces/facebook/index.ts` | `hosts: FACEBOOK_HOSTS,` |
| `src/server/marketplaces/grailed/index.ts` | `hosts: GRAILED_HOSTS,` |

(Each file already imports its `*_HOSTS` constant.) If `tsc` then reports a missing `hosts` anywhere in `tests/`, add `hosts: []` to that object.

### 1.6 Disconnect — `src/server/services/connections.ts`

Replace the body of the `if (adapter.kind === 'browser') { … }` block with:

```ts
    if (browserMode() === 'attach') {
      // One shared Chrome profile: log out of this site only by deleting its cookies, then close its tab.
      try {
        await browserManager.clearSiteCookies((adapter as unknown as BrowserAdapter).hosts ?? []);
      } catch (err) {
        logger.warn(mp.toUpperCase(), `Could not clear cookies: ${(err as Error).message}`, { marketplaceId: mp });
      }
      await browserManager.close(mp);
    } else {
      await browserManager.close(mp);
      fs.rmSync(profileDir(mp), { recursive: true, force: true });
    }
```

Change the imports to `import { browserManager, browserMode } from '../browser/browserManager';` and add `import type { BrowserAdapter } from '../marketplaces/types';`. Update the function's doc comment to: `/** Forget the saved login for a marketplace: shared Chrome → delete that site's cookies and close its tab; launch mode → close the window and delete its profile; API adapters clean up their secrets. */`

### 1.7 Calibration script — `src/server/scripts/calibrate.ts`

The script must use the same shared Chrome so it sees the same logins.

1. Replace the import `import { chromium } from 'playwright';` (whatever its exact form) with `import type { Page } from 'playwright';` and add `import { browserManager } from '../browser/browserManager';`. Change `import { profileDir, ensureDirs } from '../paths';` to `import { ensureDirs } from '../paths';`.
2. Replace lines 32–48 (from `ensureDirs();` through `const page = context.pages()[0] ?? (await context.newPage());`) with:

```ts
ensureDirs();
let page: Page;
try {
  page = await browserManager.getPage(mp);
} catch (err) {
  fail(`Could not open the browser: ${(err as Error).message.split('\n')[0]}`);
}
```

3. Replace `await context.close();` (near the end of the file) with `await browserManager.closeAll();`.

`fail` already returns `never`, so `page` is definitely assigned.

### 1.8 Settings UI — `src/web/components/settings/GeneralTab.tsx`

In the `<section>` whose heading is `Browser`:

1. Delete the whole `<div className="space-y-2 text-sm" role="radiogroup" aria-label="Browser"> … </div>` block (the two radio buttons).
2. In its place put:

```tsx
        <p className="text-sm text-zinc-600">
          Crosslister opens its own Google Chrome window with a separate profile. Every marketplace is a tab in that window. Log in once per marketplace and you stay logged in, even after restarting the app.
        </p>
```

3. Change the text `Close idle browser windows after` to `Close idle marketplace tabs after`.

Do **not** change `settingsSchema`, `Settings` or the defaults: `browser.channel` stays in the data and is only used by launch mode.

### 1.9 Connection UI — `src/web/components/settings/ConnectionControls.tsx`

Replace the `window.confirm` text with:

```ts
`This logs Crosslister's Chrome window out of ${info.name}. You'll need to log in there again.`
```

### 1.10 Tests

**A. New file `tests/server/browserManager.test.ts`** (runs in `npm test`):

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { browserMode, chromeArgs, chromeCandidates } from '../../src/server/browser/browserManager';

describe('browser manager helpers', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ['CROSSLISTER_BROWSER_MODE', 'CROSSLISTER_HEADLESS', 'CROSSLISTER_CHROMIUM_PATH', 'CROSSLISTER_CHROME_HEADLESS']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  it('chooses attach by default and launch for tests', () => {
    delete process.env.CROSSLISTER_BROWSER_MODE;
    delete process.env.CROSSLISTER_HEADLESS;
    delete process.env.CROSSLISTER_CHROMIUM_PATH;
    expect(browserMode()).toBe('attach');
    process.env.CROSSLISTER_HEADLESS = '1';
    expect(browserMode()).toBe('launch');
    delete process.env.CROSSLISTER_HEADLESS;
    process.env.CROSSLISTER_CHROMIUM_PATH = '/x/chromium';
    expect(browserMode()).toBe('launch');
    process.env.CROSSLISTER_BROWSER_MODE = 'attach';
    expect(browserMode()).toBe('attach');
    process.env.CROSSLISTER_BROWSER_MODE = 'launch';
    expect(browserMode()).toBe('launch');
  });

  it('passes only the allowed switches to Chrome', () => {
    delete process.env.CROSSLISTER_CHROME_HEADLESS;
    expect(chromeArgs('/tmp/p', 9333)).toEqual([
      '--user-data-dir=/tmp/p', '--remote-debugging-port=9333', '--no-first-run', '--no-default-browser-check',
      '--window-size=1280,900', 'about:blank',
    ]);
    process.env.CROSSLISTER_CHROME_HEADLESS = '1';
    expect(chromeArgs('/tmp/p', 9333)).toContain('--headless=new');
  });

  it('knows where Chrome lives on macOS', () => {
    expect(chromeCandidates('darwin', '/Users/x')).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/x/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
  });
});
```

**B. New file `tests/browser/attach.test.ts`** (runs in `npm run test:browser`):

```ts
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
```

If `waitFor` in `tests/helpers/fakeAdapter.ts` has a different signature than `(fn, timeoutMs)`, call it the way the other files in `tests/browser/` call it.

**C. Existing tests** must pass without edits other than the message string in §1.3 step 4. In particular `tests/marketplace/connections.test.ts` and the "disconnect deletes the profile" case in `tests/browser/mercari.test.ts` keep passing because tests run in launch mode.

### 1.11 Done when

- `npm run typecheck && npm test` pass.
- `npx playwright install chromium && npm run test:browser` passes, including `attach.test.ts`.
- Manual check by the implementer (no account needed): `npm run dev`, open Settings → Marketplaces, click **Connect** on Mercari, then on Depop. Expected: **one** Google Chrome window titled as a normal Chrome window, with a Mercari tab and a Depop tab; an "Log in to …" card for each in the Activity drawer. Stop the dev server with Ctrl+C: the Chrome window stays open. Start it again and click Connect on Mercari: a new tab opens in the same window, no second Chrome appears. Do not log in to anything.

---

## 2. M41 — Login detection that survives wrong selectors

All edits are in `src/server/marketplaces/common.ts` unless a file is named.

### 2.1 Replace `ensureLoggedIn`

Add this import: change `import { upsertConnection } from '../services/connectionStore';` to `import { getConnection, upsertConnection } from '../services/connectionStore';`.

Add these helpers directly above `ensureLoggedIn` (keep the existing `isLoggedIn`, `pollEvery2s` and `handleChallenge` as they are):

```ts
/** Same page? Compares origin + path, ignoring a trailing slash, the query and the hash. */
function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

/** True when the page is on (or within `ms` gets redirected to) the marketplace's login page. */
async function onLoginPage<T>(adapter: BrowserAdapter<T>, page: Page, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (adapter.auth.loginUrlPattern.test(page.url())) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(250);
  }
}
```

Replace the whole `ensureLoggedIn` function with:

```ts
/**
 * Login check that does not depend on the (uncalibrated) logged-in indicator being right:
 *   1. on a login URL                         → logged out
 *   2. indicator visible                      → logged in
 *   3. neither: open the sell page (it redirects to login when logged out)
 *        - redirected to login                → logged out
 *        - not redirected, and the user has confirmed a login for this marketplace before → logged in
 *        - not redirected, never confirmed    → ask the user once
 * When the user clicks "I'm logged in", they are believed unless the marketplace sends them back to its login page.
 */
export async function ensureLoggedIn<T>(ctx: JobContext, adapter: BrowserAdapter<T>, page: Page, returnUrl: string): Promise<void> {
  await handleChallenge(ctx, adapter, page);
  if (await isLoggedIn(adapter, page)) { upsertConnection(ctx.db, adapter.id, { status: 'connected' }); return; }

  if (!adapter.auth.loginUrlPattern.test(page.url())) {
    const sellUrl = resolveUrl(adapter.id, 'sell', adapter.urls.sell);
    if (!samePage(page.url(), sellUrl)) await page.goto(sellUrl, { waitUntil: 'domcontentloaded' });
    const redirected = await onLoginPage(adapter, page, 3000);
    if (!redirected && getConnection(ctx.db, adapter.id)?.status === 'connected') {
      ctx.log.warn(`Couldn't find the logged-in indicator on ${adapter.name}; continuing because the sell page did not ask for a login.`);
      if (!samePage(page.url(), returnUrl)) await page.goto(returnUrl, { waitUntil: 'domcontentloaded' });
      return;
    }
  }

  if (!adapter.auth.loginUrlPattern.test(page.url())) {
    await page.goto(resolveUrl(adapter.id, 'login', adapter.auth.loginUrl), { waitUntil: 'domcontentloaded' });
  }
  await ctx.requestUserUntil({
    reason: 'login', title: `Log in to ${adapter.name}`,
    instructions: `Log in to ${adapter.name} in the Chrome window that Crosslister opened. Complete any verification codes or security checks yourself — the app never sees your password. If you are already logged in there, just click “I'm logged in”.`,
    primaryAction: "I'm logged in",
  }, pollEvery2s(() => isLoggedIn(adapter, page)));
  await page.goto(returnUrl, { waitUntil: 'domcontentloaded' });
  await handleChallenge(ctx, adapter, page);
  if (!(await isLoggedIn(adapter, page)) && (await onLoginPage(adapter, page, 3000))) throw adapterError('LOGIN_REQUIRED', null);
  upsertConnection(ctx.db, adapter.id, { status: 'connected' });
}
```

Then run `grep -rn "Log in to .* in the browser window" tests` and update any expected instruction text to the new sentence.

### 2.2 Narrower verification prompts

In these four files, replace the `challenge` line's regex `/verify|verification code|confirm it's you/i` with the regex below (keep everything else on the line):

- `src/server/marketplaces/mercari/selectors.ts`
- `src/server/marketplaces/poshmark/selectors.ts`
- `src/server/marketplaces/depop/selectors.ts`
- `src/server/marketplaces/grailed/selectors.ts`

```ts
/verification code|verify (it's|that it's) you|verify your (identity|account|email|phone)|confirm it's you|security check/i
```

Leave `facebook/selectors.ts` unchanged.

### 2.3 A clear card when a marketplace refuses to load

Add this exported function to `common.ts`, directly above `runBrowserPublish`:

```ts
/** Opens `url`. If the marketplace answers with an error page (blocked, rate-limited, down), pause for the user instead of failing on a missing control. A 404 is left to the caller. */
export async function gotoChecked<T>(ctx: JobContext, adapter: BrowserAdapter<T>, page: Page, url: string): Promise<void> {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
  const status = resp?.status() ?? 200;
  if (status < 400 || status === 404) return;
  ctx.log.warn(`${adapter.name} answered HTTP ${status} for ${url}`);
  await ctx.requestUser({
    reason: 'other', title: `${adapter.name} didn't load`,
    instructions: `${adapter.name} showed an error page (code ${status}) instead of the page the app asked for. In the Chrome window, reload the tab or open ${adapter.name} yourself and log in. When the page looks normal, click Continue.`,
    primaryAction: 'Continue',
  });
}
```

Use it in these places (replace the `p.goto(...)` / `page.goto(...)` call, keep everything around it):

| Where | Old | New |
|---|---|---|
| `runBrowserPublish`, step `open` | `await p.goto(sellUrl, { waitUntil: 'domcontentloaded' });` | `await gotoChecked(ctx, adapter, p, sellUrl);` |
| `runBrowserDeactivate`, step `open` | `await p.goto(url, { waitUntil: 'domcontentloaded' });` | `await gotoChecked(ctx, adapter, p, url);` |
| `runBrowserUpdate`, step `open` | `await p.goto(url, { waitUntil: 'domcontentloaded' });` | `await gotoChecked(ctx, adapter, p, url);` |
| `connect()` in each of `mercari`, `poshmark`, `depop`, `facebook`, `grailed` `/index.ts` | `() => page.goto(home, { waitUntil: 'domcontentloaded' })` | `() => gotoChecked(ctx, <thatAdapter>, page, home)` — e.g. `depopAdapter`; add `gotoChecked` to that file's import from `'../common'` |

Do not use it in `browserCheckStatus`, the importers, or inside `ensureLoggedIn`.

### 2.4 Tests

1. In `fixtures/marketplace-pages/depop/sell.html` change `<nav><a href="/depop/sell.html">Profile</a></nav>` to `<nav data-fixture-id="nav"><a href="/depop/sell.html">Profile</a></nav>`. (`Fixture.applyMissing()` already runs at the end of `<body>`, so `?missing=nav` now removes the logged-in indicator.)

2. Add to `tests/browser/depop.test.ts`, inside the existing `describe`, directly after the `login path` test:

```ts
  it('believes the user when the logged-in indicator is missing, and does not ask a second time', async () => {
    await setAutoSubmit(t.app, 'depop', true);
    await req(t.app, 'POST', '/api/marketplaces/depop/disconnect');   // connection status → logged_out
    urls('?missing=nav');
    await fakeLogin('depop', env.fixtureUrl);
    const { jobId } = await start();
    const run = runner.runOnce(t.db);
    const waiting = await waitFor(async () => { const j = await job(jobId); return j.state === 'NEEDS_USER' ? j : null; }, 60_000);
    expect(waiting.needsUser.reason).toBe('login');
    await req(t.app, 'POST', `/api/jobs/${jobId}/continue`, {});
    await run;
    expect((await job(jobId)).state).toBe('SUCCESS');

    // The login was confirmed once, so the next job goes straight through.
    const second = await start();
    await runner.runOnce(t.db);
    expect((await job(second.jobId)).state).toBe('SUCCESS');
  }, 120_000);
```

What happens in that test, so a failure can be read: job 1 opens the sell page (fake login is set, so no redirect), finds no indicator, sees the connection is `logged_out`, opens the login page and shows the card; "continue" sends it back to the sell page, which does not redirect, so the user is believed and the connection becomes `connected`. Job 2 finds no indicator again, but the connection is `connected` and the sell page does not redirect, so it continues without asking.

### 2.5 Done when

`npm run typecheck && npm test && npm run test:browser` pass.

---

## 3. M42 — Small fixes

### 3.1 `/listings/new` — `src/web/App.tsx`

Add this route on the line directly above `{ path: '/listings/:id/edit', … }`:

```tsx
      { path: '/listings/new', element: <Navigate to="/listings/new/edit" replace /> },
```

### 3.2 Validation row text — `src/web/components/CrosslistFlow.tsx`

Replace

```tsx
                      {own.length === 0 && <p className="text-zinc-500">No issues.</p>}
```

with

```tsx
                      {own.length === 0 && <p className="text-zinc-500">{st === 'error' ? 'Nothing else needed here — fix the items at the top first.' : 'No issues.'}</p>}
```

### 3.3 Depop weight warning — `src/server/marketplaces/depop/index.ts`

Replace the `validate(l) { … }` method with:

```ts
  validate(l) {
    const issues: Array<{ field: string; severity: 'warning'; message: string }> = [];
    if (l.colors.length > 2) issues.push({ field: 'colors', severity: 'warning', message: 'Depop accepts up to 2 colors.' });
    if (depopParcelSize(l.shipping.weightOz) === null) {
      issues.push({ field: 'shipping.weightOz', severity: 'warning', message: 'Add the package weight (Shipping → Weight) so the app can choose the Depop parcel size for you.' });
    }
    return issues;
  },
```

(`depopParcelSize` returns `null` when `weightOz` is `null`; `shipping.weightOz` is the field name the Mercari weight error already uses in `src/server/services/validation.ts`.)

Add to `tests/marketplace/depop/mapping.test.ts`, using that file's existing `eff()` helper (its default listing has `weightOz: 16`):

```ts
  it('warns when there is no package weight for the parcel size', () => {
    const noWeight = eff({ shipping: { weightOz: null, lengthIn: null, widthIn: null, heightIn: null, whoPays: 'buyer' } });
    expect(depopAdapter.validate(noWeight).some((i) => /package weight/.test(i.message))).toBe(true);
    expect(depopAdapter.validate(eff()).some((i) => /package weight/.test(i.message))).toBe(false);
  });
```

Put it inside the file's top-level `describe`. If any existing test now fails only because a Depop listing without a weight gained this warning, give that test's listing `weightOz: 16`; do not weaken the new warning.

### 3.4 Done when

`npm run typecheck && npm test` pass. In the running app: `http://localhost:5173/listings/new` opens the editor.

---

## 4. M43 — Docs

Edit text only; no code.

1. **`README.md`**
   - Where it says the app "opens the marketplace in a browser window (where you are logged in)", change to "opens the marketplace as a tab in its own Google Chrome window (you log in there once per marketplace and stay logged in)".
   - In the Connect paragraph, replace "A browser window opens at its login page" with "Crosslister's own Google Chrome window opens a tab at the marketplace".
   - Replace the `browser-profiles/` bullet with: "`browser-profiles/chrome/` — the Chrome profile Crosslister uses, including your marketplace logins (never included in backups)".
2. **`docs/SETUP.md`**
   - Requirements: replace the Google Chrome line with "Google Chrome (required for the browser marketplaces). Crosslister starts it with its own profile; your everyday Chrome profile is not touched."
   - Folder table: replace the `browser-profiles/<marketplace>/` row with `browser-profiles/chrome/` | "the Chrome profile Crosslister uses (all marketplace logins)". Add below the table: "Folders named `browser-profiles/mercari`, `poshmark`, … are left over from older versions and can be deleted."
   - "Connect the browser marketplaces": rewrite the first paragraph as: "Settings → Marketplaces → **Connect**. Crosslister opens its own Google Chrome window (separate from your everyday Chrome) with one tab per marketplace. Log in yourself, including two-factor codes — the app never sees your password. You only need to do this once per marketplace: the window can stay open, and the login is remembered even if you close it or restart the app. If the app doesn't notice that you are logged in, click **I'm logged in** on the card."
   - Add a short section "The Chrome window" with these three points: closing a marketplace tab while a job is running stops that job; quitting that Chrome window is fine — the app reopens it when needed; the window listens on local port 9333 for the app (`CROSSLISTER_CDP_PORT` changes it) — only programs on your own Mac can reach it.
3. **`docs/TROUBLESHOOTING.md`**
   - Replace the "The browser window doesn't open." entry with: "**The Chrome window doesn't open.** → Google Chrome is not installed, or the app could not start it. → Install Google Chrome. If it is installed in an unusual place, set `CROSSLISTER_CHROME_PATH` in `.env`. If another program uses port 9333, set `CROSSLISTER_CDP_PORT=9444`."
   - Replace the "The browser profile is in use." entry with: "**"Couldn't start Google Chrome for Crosslister."** → A leftover Crosslister Chrome is half-open. → Quit that Chrome window (the one with the marketplace tabs) and try again."
   - Add: "**I'm logged in but the app keeps asking.** → The app's way of recognising a logged-in page is out of date for that marketplace. → Click **I'm logged in** on the card; the app remembers it. Then run `npm run calibrate -- <marketplace> home` to fix the selector."
   - Add: "**"<Marketplace> didn't load".** → The marketplace showed an error page (often a temporary block or rate limit). → Reload the tab in the Chrome window, or wait a few minutes; when the page looks normal click **Continue**."
4. **`docs/MARKETPLACE_ADAPTERS.md`** — in the calibration section add one sentence: "The calibration script uses the same Chrome window and logins as the app."
5. **`docs/spec/05-marketplace-framework.md`** §8.1 — add as the first line under the heading: "> Superseded for real use by `13-round-2-fixes.md` §1 (one shared Chrome, attach mode). The text below describes launch mode, which tests still use."
6. **`IMPLEMENTATION_SUMMARY.md`**
   - Add a row to the milestone table: `| M40–M43 (round 2: shared Chrome window, login detection, small fixes) | Done |`.
   - Under "Decisions made during implementation" add a bullet **Shared Chrome (M40)** summarising: attach mode vs launch mode, the env variables, Chrome is started detached and survives app restarts, disconnect clears cookies per site, tabs from before a restart are not adopted.
   - Under "Known bugs / gaps" add: "Attach mode (the real Chrome window) is covered by `tests/browser/attach.test.ts` with headless Chromium only; the marketplace flows themselves are still tested in launch mode against fixtures." and "Depop loading in the shared Chrome window has not been confirmed on a real account."
7. **`CLAUDE.md`** — change the "Current milestone" line to: `**Current milestone:** M1–M43 done — see `IMPLEMENTATION_SUMMARY.md` (browser adapters are assisted, uncalibrated).`

Done when: `npm run typecheck && npm test` pass and the commit `M43: Round 2 docs` exists.

---

## 5. After M43 — checks only the user can do

The implementing agent cannot log in to marketplaces. Leave this list for the user in the final message:

1. Settings → Marketplaces → Connect on each of Mercari, Poshmark, Depop, Facebook, Grailed; log in in the Chrome window. Note which ones the app recognises by itself and which need **I'm logged in**.
2. Does Depop load now? If it still shows its error page in the Crosslister Chrome window, report the exact text and whether it also happens when you type the address into that same window by hand.
3. Quit the app, start it again, cross-list one item: you should not be asked to log in again.
4. For each marketplace that needed **I'm logged in**: `npm run calibrate -- <marketplace> home` and send the output.
