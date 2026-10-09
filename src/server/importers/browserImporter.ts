import type { Page } from 'playwright';
import type { ExtractedProduct } from '../browser/extract';
import { ensureLoggedIn, resolveUrl } from '../marketplaces/common';
import type { BrowserAdapter } from '../marketplaces/types';
import { getConnection } from '../services/connectionStore';
import type { JobContext } from '../services/jobContext';
import { downloadWithBrowser, fetchByUrl } from './urlImporter';
import type { DiscoveredItem, MarketplaceImporter } from './types';

const MAX_ITEMS = 500;

interface Anchor { href: string; text: string; alt: string; img: string }

/** Shop-page scan (07 §5.3): collect the user's own listing links while scrolling. */
export async function scanShopPage(
  ctx: JobContext, adapter: BrowserAdapter, shopUrl?: (accountName: string | null) => string | null,
): Promise<DiscoveredItem[]> {
  const page = await ctx.page();
  const account = getConnection(ctx.db, adapter.id)?.accountName ?? null;
  const url = shopUrl?.(account) ?? null;
  const start = url ?? resolveUrl(adapter.id, 'home', adapter.urls.home);
  await page.goto(start, { waitUntil: 'domcontentloaded' });
  await ensureLoggedIn(ctx, adapter, page, start);
  if (!url) {
    await ctx.requestUser({
      reason: 'other', title: `Open your listings on ${adapter.name}`,
      instructions: 'In the browser window, go to the page that shows all of your own listings (your shop or closet). Then click Continue.',
      primaryAction: 'Continue',
    });
  }
  const found = new Map<string, DiscoveredItem>();
  let idleRounds = 0;
  while (idleRounds < 3 && found.size < MAX_ITEMS) {
    ctx.throwIfCancelled();
    const before = found.size;
    const anchors: Anchor[] = await page.$$eval('a[href]', (els) => els.map((a) => ({
      href: (a as HTMLAnchorElement).href, text: (a as HTMLElement).innerText ?? '',
      alt: a.querySelector('img')?.getAttribute('alt') ?? '', img: a.querySelector('img')?.getAttribute('src') ?? '',
    })));
    for (const a of anchors) {
      let u: URL;
      try { u = new URL(a.href); } catch { continue; }
      const m = adapter.listingPathRegex.exec(u.pathname);
      if (!m?.[1] || found.has(m[1])) continue;
      found.set(m[1], {
        remoteId: m[1], url: `${u.origin}${u.pathname}`, title: (a.text.trim() || a.alt.trim()).slice(0, 200), thumbUrl: a.img || null,
      });
      if (found.size >= MAX_ITEMS) break;
    }
    idleRounds = found.size === before ? idleRounds + 1 : 0;
    ctx.progress(`Found ${found.size} listings…`);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await ctx.sleep(process.env.CROSSLISTER_IMPORT_DELAY_MS === '0' ? 50 : 1500);
  }
  return [...found.values()];
}

export function createBrowserImporter(adapter: BrowserAdapter, opts: {
  shopUrl?: (accountName: string | null) => string | null;
  extractExtra?: (page: Page) => Promise<Partial<ExtractedProduct>>;
} = {}): MarketplaceImporter {
  return {
    methods: ['shop_page', 'urls'],
    scan: (ctx) => scanShopPage(ctx, adapter, opts.shopUrl),
    fetch: (ctx, item) => fetchByUrl(ctx, adapter, item, opts),
    downloadPhoto: (ctx, url, dest) => downloadWithBrowser(ctx, adapter, url, dest),
  };
}
