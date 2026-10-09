import fs from 'node:fs';
import type { Page } from 'playwright';
import { browserManager } from '../browser/browserManager';
import { extractProduct, type ExtractedProduct } from '../browser/extract';
import { adapterError } from '../marketplaces/adapterError';
import { ensureLoggedIn } from '../marketplaces/common';
import type { BrowserAdapter, MarketplaceAdapter } from '../marketplaces/types';
import type { JobContext } from '../services/jobContext';
import type { ImportedListing, MarketplaceImporter } from './types';

export interface UrlImporterOpts { extractExtra?: (page: Page) => Promise<Partial<ExtractedProduct>> }

/** Browser adapters use their own profile; manual marketplaces share the `other` profile. */
export function importPage(ctx: JobContext, adapter: MarketplaceAdapter): Promise<Page> {
  return adapter.kind === 'browser' ? ctx.page() : browserManager.getPage('other');
}

export function toImported(url: string, remoteId: string | null, x: ExtractedProduct): ImportedListing {
  return {
    remoteId: remoteId ?? url, url, title: x.title ?? '', description: x.description ?? '', priceCents: x.priceCents ?? null,
    conditionText: x.condition ?? null, categoryTexts: x.category ?? [], brand: x.brand ?? '', size: x.size ?? '',
    colorTexts: x.color ? [x.color] : [], photoUrls: x.images, status: x.availability ?? 'unknown', quantity: 1, extra: {},
  };
}

export async function fetchByUrl(ctx: JobContext, adapter: MarketplaceAdapter, item: { remoteId: string | null; url: string }, opts: UrlImporterOpts = {}): Promise<ImportedListing> {
  const page = await importPage(ctx, adapter);
  await page.goto(item.url, { waitUntil: 'domcontentloaded' });
  await ctx.sleep(process.env.CROSSLISTER_IMPORT_DELAY_MS === '0' ? 0 : 2000);
  if (adapter.kind === 'browser') {
    const b = adapter as BrowserAdapter;
    if (b.auth.loginUrlPattern.test(page.url())) await ensureLoggedIn(ctx, b, page, item.url);
  }
  const x = await extractProduct(page, opts.extractExtra);
  if (!x.title) throw adapterError('ELEMENT_NOT_FOUND', adapter.name, { what: 'listing details on that page' });
  const parsed = adapter.parseListingUrl(item.url);
  return toImported(page.url(), item.remoteId ?? parsed?.remoteId ?? null, x);
}

export async function downloadWithBrowser(ctx: JobContext, adapter: MarketplaceAdapter, url: string, dest: string): Promise<void> {
  const page = await importPage(ctx, adapter);
  const res = await page.context().request.get(url);
  if (!res.ok()) throw new Error(`Photo download failed (${res.status()}).`);
  fs.writeFileSync(dest, await res.body());
}

/** Generic importer: pasted URLs, read via JSON-LD / OpenGraph (07 §5.2). */
export function createUrlImporter(adapter: MarketplaceAdapter, opts: UrlImporterOpts = {}): MarketplaceImporter {
  return {
    methods: ['urls'],
    fetch: (ctx, item) => fetchByUrl(ctx, adapter, item, opts),
    downloadPhoto: (ctx, url, dest) => downloadWithBrowser(ctx, adapter, url, dest),
  };
}
