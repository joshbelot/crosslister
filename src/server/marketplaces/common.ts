import type { Page } from 'playwright';
import { z } from 'zod';
import { COLORS, type ColorId } from '../../shared/colors';
import type { Condition } from '../../shared/constants';
import { formatCents } from '../../shared/money';
import { categoryAncestry, lookupByCategory } from '../../shared/taxonomy';
import type { CopyField, DataFieldDef, MarketplaceListing, NeedsUserRequest } from '../../shared/types';
import { click, pace } from '../browser/actions';
import { exists, type LocatorSpec } from '../browser/locators';
import type { Db } from '../db/client';
import { upsertConnection } from '../services/connections';
import type { JobContext } from '../services/jobContext';
import { getKv } from '../services/settings';
import type { BrowserAdapter, EffectiveListing, MarketplaceAdapter, PublishResult } from './types';

export * from './adapterError';
import { AdapterError, adapterError, toAdapterError } from './adapterError';

/** Fixture tests point adapters at local pages with CROSSLISTER_URL_OVERRIDES (05 §8.6). */
export function resolveUrl(mp: string, key: string, defaultUrl: string): string {
  const raw = process.env.CROSSLISTER_URL_OVERRIDES;
  if (!raw) return defaultUrl;
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
    return parsed[mp]?.[key] ?? defaultUrl;
  } catch {
    return defaultUrl;
  }
}

/** Suffix host match (`www.mercari.com` matches `mercari.com`). Skipped when URL overrides are active. */
export function hostOk(url: string, hosts: string[]): boolean {
  if (process.env.CROSSLISTER_URL_OVERRIDES) return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return hosts.some((x) => h === x || h.endsWith('.' + x));
  } catch {
    return false;
  }
}

export function lastPathSegment(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  } catch {
    return '';
  }
}

/** Values offered with copy buttons in "needs your attention" cards (05 §7.2 step 4). */
export function standardCopyFields<T>(eff: EffectiveListing<T>, mapping: Array<{ label: string; value: string }>): CopyField[] {
  const colorLabels = eff.colors.map((c) => COLORS.find((x) => x.id === c)?.label ?? c).join(', ');
  const fields: CopyField[] = [
    { label: 'Title', value: eff.title },
    { label: 'Description', value: eff.description },
    { label: 'Price', value: formatCents(eff.priceCents) },
    { label: 'Brand', value: eff.brand },
    { label: 'Size', value: eff.size },
    ...mapping,
    { label: 'Colors', value: colorLabels },
    { label: 'Tags', value: eff.tags.join(', ') },
  ];
  return fields.filter((f) => f.value.trim() !== '');
}

export type { MarketplaceListing };

// ---------------------------------------------------------------------------------------------
// Shared helpers for browser adapters (06 intro)
// ---------------------------------------------------------------------------------------------

export const browserCommonData = {
  categoryPath: z.string().max(300).optional(),        // "A > B > C" per-listing override
  conditionOverride: z.string().max(60).optional(),    // exact marketplace condition label
};

export function browserCommonDataFields(marketplaceName: string, conditionLabels: string[]): DataFieldDef[] {
  return [
    { key: 'categoryPath', label: `Category on ${marketplaceName}`, type: 'path', help: 'Example: Men > Shoes > Sneakers. Leave empty to use the automatic mapping.' },
    { key: 'conditionOverride', label: `Condition on ${marketplaceName}`, type: 'select', options: conditionLabels.map((c) => ({ value: c, label: c })) },
  ];
}

export type CategoryPath = Array<string | string[]>;

/** Canonical ancestry minus skipped nodes; each segment lists the node label first, then marketplace synonyms. */
export function buildCategoryPath(
  categoryId: string,
  opts: { synonyms?: Record<string, string[]>; overrides?: Record<string, CategoryPath>; skip?: string[] } = {},
): CategoryPath | null {
  const override = opts.overrides ? lookupByCategory(opts.overrides, categoryId) : undefined;
  if (override) return override;
  const nodes = categoryAncestry(categoryId).filter((n) => !(opts.skip ?? []).includes(n.id));
  if (nodes.length === 0) return null;
  return nodes.map((n) => {
    const syn = opts.synonyms?.[n.id];
    return syn && syn.length ? [n.label, ...syn] : n.label;
  });
}

const parsePathString = (s: string): CategoryPath => s.split('>').map((x) => x.trim()).filter(Boolean);

let adapterDb: Db | null = null;
/** Lets synchronous adapter hooks (describeMapping, validate) read the user's category map. Set once by buildApp. */
export function setAdapterDb(db: Db | null): void { adapterDb = db; }
export const getAdapterDb = (): Db | null => adapterDb;

/** Category path for previews/validation, using the app's database when available. */
export function categoryPathFor<T>(adapter: MarketplaceAdapter<T>, eff: EffectiveListing<T>): CategoryPath | null {
  return resolveCategoryPath(adapterDb, adapter, eff, eff.data as Record<string, unknown>);
}

/** Per-listing override → user category map → adapter built-in → null (05 §1.1). */
export function resolveCategoryPath<T>(db: Db | null, adapter: MarketplaceAdapter<T>, eff: EffectiveListing<T>, mlData: Record<string, unknown>): CategoryPath | null {
  const own = typeof mlData.categoryPath === 'string' ? parsePathString(mlData.categoryPath) : [];
  if (own.length) return own;
  if (!eff.categoryId) return null;
  const map = db ? getKv<Record<string, string>>(db, `category_map_${adapter.id}`, {}) : {};
  const mapped = lookupByCategory(map, eff.categoryId);
  if (mapped) {
    const p = parsePathString(mapped);
    if (p.length) return p;
  }
  return adapter.categoryPath?.(eff.categoryId) ?? null;
}

/** Wanted synonyms for the listing's condition (`override` is an exact marketplace label). */
export function mapCondition(eff: { condition: Condition | null }, table: Record<Condition, string[]>, override?: string): string[] | null {
  if (override) return [override];
  return eff.condition ? table[eff.condition] : null;
}

/** Synonym lists for up to `max` colors that have a mapping on this marketplace. */
export function mapColors(colors: ColorId[], table: Record<ColorId, string[]>, max: number): string[][] {
  return colors.map((c) => table[c]).filter((m): m is string[] => Array.isArray(m) && m.length > 0).slice(0, max);
}

const sleepAbortable = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(adapterError('CANCELLED', null));
  const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(adapterError('CANCELLED', null)); };
  signal.addEventListener('abort', onAbort, { once: true });
});

/** Poll `check` until it returns true (or the signal aborts). */
export async function pollUntil(signal: AbortSignal, check: () => Promise<boolean>, everyMs = 1500): Promise<void> {
  for (;;) {
    if (signal.aborted) throw adapterError('CANCELLED', null);
    try { if (await check()) return; } catch (err) { if (/closed/i.test(String((err as Error).message))) throw err; }
    await sleepAbortable(everyMs, signal);
  }
}

/**
 * Resolves when the page URL path matches `pathRegex`, or when `successText` is visible and a link on the page matches it.
 * Returns the captured remote id (group 1) and the absolute URL.
 */
export async function detectByUrlOrLink(
  page: Page, pathRegex: RegExp, signal: AbortSignal, opts: { successText?: RegExp } = {},
): Promise<{ remoteId: string; url: string }> {
  for (;;) {
    if (signal.aborted) throw adapterError('CANCELLED', null);
    try {
      const url = new URL(page.url());
      const m = pathRegex.exec(url.pathname);
      if (m?.[1]) return { remoteId: m[1], url: `${url.origin}${url.pathname}` };
      if (opts.successText && (await page.getByText(opts.successText).first().isVisible().catch(() => false))) {
        const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
        for (const href of hrefs) {
          const u = new URL(href);
          const mm = pathRegex.exec(u.pathname);
          if (mm?.[1]) return { remoteId: mm[1], url: `${u.origin}${u.pathname}` };
        }
      }
    } catch (err) {
      if (/closed/i.test(String((err as Error).message))) throw err;
    }
    await sleepAbortable(1500, signal);
  }
}

// ---------------------------------------------------------------------------------------------
// Login handling and the browser publish / deactivate templates (05 §7)
// ---------------------------------------------------------------------------------------------

async function isLoggedIn<T>(adapter: BrowserAdapter<T>, page: Page): Promise<boolean> {
  try {
    if (adapter.auth.loginUrlPattern.test(page.url())) return false;
    return await exists(page, adapter.auth.loggedInIndicator, 4000);
  } catch (err) {
    if (/closed/i.test(String((err as Error).message))) throw err;
    return false;
  }
}

function pollEvery2s(fn: () => Promise<boolean>) {
  return async (signal: AbortSignal): Promise<true> => {
    for (;;) {
      if (await fn()) return true;
      await sleepAbortable(2000, signal);
    }
  };
}

/** Pauses for the user when the marketplace shows a verification page. Never touches the challenge itself. */
async function handleChallenge<T>(ctx: JobContext, adapter: BrowserAdapter<T>, page: Page): Promise<void> {
  const ci = adapter.auth.challengeIndicator;
  if (!ci || !(await exists(page, ci, 1500))) return;
  await ctx.requestUserUntil({
    reason: 'verification', title: `${adapter.name} needs you to verify it's you`,
    instructions: 'Complete the check in the browser window, then click Continue.', primaryAction: 'Continue',
  }, pollEvery2s(async () => !(await exists(page, ci, 1000))));
}

export async function ensureLoggedIn<T>(ctx: JobContext, adapter: BrowserAdapter<T>, page: Page, returnUrl: string): Promise<void> {
  await handleChallenge(ctx, adapter, page);
  if (await isLoggedIn(adapter, page)) { upsertConnection(ctx.db, adapter.id, { status: 'connected' }); return; }
  await page.goto(resolveUrl(adapter.id, 'login', adapter.auth.loginUrl), { waitUntil: 'domcontentloaded' });
  await ctx.requestUserUntil({
    reason: 'login', title: `Log in to ${adapter.name}`,
    instructions: `Log in to ${adapter.name} in the browser window. Complete any verification codes or security checks yourself — the app never sees your password. The app continues automatically once you're logged in.`,
    primaryAction: "I'm logged in",
  }, pollEvery2s(() => isLoggedIn(adapter, page)));
  await page.goto(returnUrl, { waitUntil: 'domcontentloaded' });
  await handleChallenge(ctx, adapter, page);
  if (!(await isLoggedIn(adapter, page))) throw adapterError('LOGIN_REQUIRED', null);
  upsertConnection(ctx.db, adapter.id, { status: 'connected' });
}

export interface BrowserRecipe<TData> {
  fields: Array<{ key: string; label: string; required?: boolean; run: (page: Page, l: EffectiveListing<TData>, ctx: JobContext) => Promise<void> }>;
  submitButton: LocatorSpec;
  submitLabel: string;
  detectPublished: (page: Page, l: EffectiveListing<TData>, signal: AbortSignal) => Promise<{ remoteId: string; url: string }>;
  findAfterManualPublish?: (page: Page, l: EffectiveListing<TData>) => Promise<{ remoteId: string; url: string } | null>;
}

const withTimeout = <T>(p: Promise<T>, ms: number, controller: AbortController): Promise<T | 'timeout'> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => { controller.abort(); resolve('timeout'); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); if (controller.signal.aborted) resolve('timeout'); else reject(e); });
  });

/** Maps a user's answer (URL or none) to a publish result. */
async function resultFromUser<TData>(
  adapter: BrowserAdapter<TData>, page: Page, l: EffectiveListing<TData>, r: BrowserRecipe<TData>, url: string | null,
): Promise<PublishResult> {
  if (url) {
    const parsed = adapter.parseListingUrl(url);
    return parsed ? { ...parsed, verified: true } : { remoteId: null, url, verified: false };
  }
  const fromPage = adapter.parseListingUrl(page.url());
  if (fromPage) return { ...fromPage, verified: true };
  const found = await r.findAfterManualPublish?.(page, l).catch(() => null);
  if (found) return { ...found, verified: true };
  return { remoteId: null, url: null, verified: false };
}

export async function runBrowserPublish<TData>(ctx: JobContext, adapter: BrowserAdapter<TData>, l: EffectiveListing<TData>, r: BrowserRecipe<TData>): Promise<PublishResult> {
  const N = adapter.name;
  const sellUrl = resolveUrl(adapter.id, 'sell', adapter.urls.sell);
  const page = await ctx.step('open', `Opening ${N}`, async () => {
    const p = await ctx.page();
    await p.goto(sellUrl, { waitUntil: 'domcontentloaded' });
    return p;
  });
  await ctx.step('login', 'Checking login', () => ensureLoggedIn(ctx, adapter, page, sellUrl));

  for (const [i, f] of r.fields.entries()) {
    const run = () => f.run(page, l, ctx);
    if (f.required) await ctx.step(f.key, f.label, run); else await ctx.tryStep(f.key, f.label, run);
    if (i < r.fields.length - 1) await pace(ctx);
  }

  const copyFields = standardCopyFields(l, adapter.describeMapping(l));
  const missing = ctx.missingFields.length > 0;
  const autoSubmit = ctx.prefs.autoSubmit && adapter.capabilities.autoSubmitAllowed && !missing;

  const askAfterAutoSubmit = async (): Promise<PublishResult> => {
    const a = await ctx.requestUser({
      reason: 'review_and_submit', title: `Confirm ${N} listing`,
      instructions: `The app clicked “${r.submitLabel}” but couldn't confirm the result. Check the browser window. If the listing is live, paste its URL below and click “It's published”.`,
      allowUrlInput: true, copyFields, primaryAction: "It's published",
    });
    return resultFromUser(adapter, page, l, r, a.url);
  };

  if (autoSubmit) {
    await ctx.step('submit', 'Publishing', () => click(page, r.submitButton));
    const outcome = await ctx.step('confirm', 'Confirming', async () => {
      const controller = new AbortController();
      ctx.signal.addEventListener('abort', () => controller.abort(), { once: true });
      const detected = await withTimeout(r.detectPublished(page, l, controller.signal), 60_000, controller);
      if (detected === 'timeout') {
        if (ctx.signal.aborted) throw adapterError('CANCELLED', null);
        return null;
      }
      return detected;
    });
    if (outcome) return { ...outcome, verified: true };
    return askAfterAutoSubmit();
  }

  const answer = await ctx.requestUserUntil({
    reason: missing ? 'fields' : 'review_and_submit',
    title: missing ? `${N} requires your attention` : `Review and publish on ${N}`,
    instructions: (missing ? `The app couldn't fill: ${ctx.missingFields.join(', ')}. Fill them in the browser window. ` : 'Everything is filled in. ')
      + `Review the listing and click “${r.submitLabel}” in the browser. The app will notice when it's published.`,
    missingFields: missing ? [...ctx.missingFields] : undefined,
    copyFields, allowUrlInput: true, primaryAction: 'I published it',
  }, (signal) => r.detectPublished(page, l, signal));
  if (answer.by === 'detected') return { ...answer.value, verified: true };
  return resultFromUser(adapter, page, l, r, answer.url);
}

export interface DeactivateRecipe {
  editUrl: (ml: MarketplaceListing) => string;
  steps: Array<{ key: string; label: string; run: (page: Page, ctx: JobContext) => Promise<void> }>;
  confirmButton: LocatorSpec;
  confirmLabel: string;
  detectDone: (page: Page, ml: MarketplaceListing, signal: AbortSignal) => Promise<void>;
}

export async function runBrowserDeactivate<T>(ctx: JobContext, adapter: BrowserAdapter<T>, ml: MarketplaceListing, r: DeactivateRecipe): Promise<void> {
  const N = adapter.name;
  const url = r.editUrl(ml);
  const page = await ctx.step('open', `Opening ${N}`, async () => {
    const p = await ctx.page();
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    return p;
  });
  await ctx.step('login', 'Checking login', () => ensureLoggedIn(ctx, adapter, page, url));

  const manual = (): Promise<unknown> => ctx.requestUser({
    reason: 'manual_delist', title: `Remove from ${N}`,
    instructions: "Couldn't find the delete button automatically. Remove the listing in the browser window, then click “It's removed”.",
    link: { label: 'Open listing', url: ml.url ?? adapter.urls.home }, primaryAction: "It's removed",
  });

  try {
    for (const s of r.steps) { await ctx.step(s.key, s.label, () => s.run(page, ctx)); await pace(ctx); }
    const autoSubmit = ctx.prefs.autoSubmit && adapter.capabilities.autoSubmitAllowed;
    if (autoSubmit) {
      await ctx.step('confirm-delete', r.confirmLabel, () => click(page, r.confirmButton));
      const controller = new AbortController();
      ctx.signal.addEventListener('abort', () => controller.abort(), { once: true });
      const done = await withTimeout(r.detectDone(page, ml, controller.signal), 30_000, controller);
      if (done === 'timeout') {
        if (ctx.signal.aborted) throw adapterError('CANCELLED', null);
        await ctx.requestUser({
          reason: 'confirm_delete', title: `Confirm removal from ${N}`,
          instructions: `The app clicked “${r.confirmLabel}” but couldn't confirm the result. Check the browser window and click “It's removed” once the listing is gone.`,
          primaryAction: "It's removed",
        });
      }
      return;
    }
    await ctx.requestUserUntil({
      reason: 'confirm_delete', title: `Remove from ${N}`,
      instructions: `Click “${r.confirmLabel}” in the browser window to remove the listing from ${N}.`,
      primaryAction: "It's removed",
    }, (signal) => r.detectDone(page, ml, signal));
  } catch (err) {
    const e = toAdapterError(err, N);
    if (['CANCELLED', 'BROWSER_CLOSED', 'LOGIN_REQUIRED'].includes(e.code) || ctx.signal.aborted) throw err;
    ctx.log.warn(`Delete steps failed (${e.detail ?? e.message}); asking the user to remove it.`);
    await manual();
  }
}
