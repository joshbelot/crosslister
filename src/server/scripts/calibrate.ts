import readline from 'node:readline/promises';
import { chromium } from 'playwright';
import { MARKETPLACE_IDS, type MarketplaceId } from '../../shared/constants';
import { exists } from '../browser/locators';
import { getAdapter } from '../marketplaces/registry';
import type { BrowserAdapter } from '../marketplaces/types';
import { profileDir, ensureDirs } from '../paths';
import { resolveUrl } from '../marketplaces/common';

const [, , idArg, pageArg = 'sell'] = process.argv;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!idArg || !(MARKETPLACE_IDS as readonly string[]).includes(idArg)) {
  fail(`Usage: npm run calibrate -- <marketplace> [sell|home|edit:<remoteId>|<full URL>]\nMarketplaces: ${MARKETPLACE_IDS.join(', ')}`);
}
const mp = idArg as MarketplaceId;
const adapter = getAdapter(mp);
if (adapter.kind !== 'browser') fail(`${adapter.name} is not a browser marketplace, so there is nothing to calibrate.`);
const browserAdapter = adapter as BrowserAdapter;

let groupKey: 'sell' | 'edit' | 'item' | 'home' = 'sell';
let url: string;
if (/^https?:\/\//i.test(pageArg)) url = pageArg;
else if (pageArg === 'home') { groupKey = 'home'; url = resolveUrl(mp, 'home', adapter.urls.home); }
else if (pageArg.startsWith('edit:')) { groupKey = 'edit'; url = adapter.listingUrl(pageArg.slice(5)); }
else url = resolveUrl(mp, 'sell', adapter.urls.sell);

ensureDirs();
let context;
try {
  context = await chromium.launchPersistentContext(profileDir(mp), {
    headless: false, viewport: null, args: ['--window-size=1280,900'],
    ...(process.env.CROSSLISTER_CHROMIUM_PATH ? { executablePath: process.env.CROSSLISTER_CHROMIUM_PATH } : { channel: 'chrome' as const }),
  });
} catch (err) {
  const msg = (err as Error).message;
  if (/ProcessSingleton|profile|already in use|SingletonLock/i.test(msg)) fail('Quit Crosslister first (the browser profile is in use).');
  try {
    context = await chromium.launchPersistentContext(profileDir(mp), { headless: false, viewport: null, args: ['--window-size=1280,900'] });
  } catch (err2) {
    fail(`Could not open the browser: ${(err2 as Error).message.split('\n')[0]}`);
  }
}
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => undefined);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = 'Log in if needed and navigate to the page you want to check. Then press Enter here to run the selector check, or type `pause` to open the Playwright Inspector.\n> ';

for (;;) {
  const answer = (await rl.question(prompt)).trim().toLowerCase();
  if (answer === 'pause') { await page.pause(); continue; }
  const specs = browserAdapter.selectorGroups[groupKey];
  console.log(`\nChecking ${specs.length} controls on ${page.url()}\n`);
  let failures = 0;
  for (const spec of specs) {
    const ok = await exists(page, spec, 3000);
    if (!ok) failures++;
    const candidate = JSON.stringify(spec.candidates[0]);
    console.log(`${ok ? '✓' : '✗'}  ${spec.what.padEnd(34)} ${ok ? '' : `(first candidate: ${candidate})`}`);
  }
  console.log(`\n${failures === 0 ? 'All controls found.' : `${failures} control(s) not found. Add a working candidate at the TOP of that spec in selectors.ts, then run this again.`}\n`);
  const again = (await rl.question('Press Enter to check again, or type `done` to quit.\n> ')).trim().toLowerCase();
  if (again === 'done' || again === 'quit' || again === 'q') break;
}
rl.close();
await context.close();
