import type { Page } from 'playwright';
import { z } from 'zod';
import { lookupByCategory } from '../../../shared/taxonomy';
import { sizeSynonyms } from '../../../shared/sizes';
import type { MarketplaceCapabilities, MarketplaceListing } from '../../../shared/types';
import { chooseOption, click, fillText, setCheckbox, typeahead, uploadFiles, waitForUrl } from '../../browser/actions';
import { exists } from '../../browser/locators';
import { bestMatch } from '../../browser/match';
import { AdapterError } from '../adapterError';
import {
  browserCommonData, browserCommonDataFields, ensureLoggedIn, hostOk, mapCondition, pollUntil, resolveUrl, runBrowserDeactivate, runBrowserPublish,
  runBrowserUpdate, type BrowserRecipe, type DeactivateRecipe, type UpdateRecipe,
} from '../common';
import { getKv } from '../../services/settings';
import type { BrowserAdapter, EffectiveListing } from '../types';
import {
  FACEBOOK_CONDITIONS, FACEBOOK_CONDITION_LABELS, FACEBOOK_HOSTS, FACEBOOK_LISTING_REGEX, facebookCategoryTerms,
  facebookListingUrl, termFromPath,
} from './mapping';
import { sel, selectorGroups } from './selectors';
import { getAdapterDb } from '../common';

const dataSchema = z.object({ ...browserCommonData, hideFromFriends: z.boolean().default(false) });
type FacebookData = z.infer<typeof dataSchema>;

const capabilities: MarketplaceCapabilities = {
  publish: 'assisted', update: 'assisted', deactivate: 'assisted', statusCheck: 'none', import: 'url',
  autoSubmitAllowed: false, maxPhotos: 10, titleMaxLength: 100, descriptionMaxLength: 5000, minPriceCents: 100, maxPriceCents: null,
  requires: ['title', 'price', 'condition', 'category'],
};

/** Search terms for the category combobox: per-listing path → user map (last segment) → built-in terms. */
function categoryTerms(l: EffectiveListing<FacebookData>): string[] | null {
  if (typeof l.data.categoryPath === 'string') { const t = termFromPath(l.data.categoryPath); if (t) return [t]; }
  if (!l.categoryId) return null;
  const db = getAdapterDb();
  if (db) {
    const map = getKv<Record<string, string>>(db, 'category_map_facebook', {});
    const mapped = lookupByCategory(map, l.categoryId);
    const t = mapped ? termFromPath(mapped) : null;
    if (t) return [t];
  }
  return facebookCategoryTerms(l.categoryId);
}

const myListingsUrl = () => resolveUrl('facebook', 'myListings', 'https://www.facebook.com/marketplace/you/selling');

async function findAfterManualPublish(page: Page, l: EffectiveListing<FacebookData>): Promise<{ remoteId: string; url: string } | null> {
  await page.goto(myListingsUrl(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const cards = await page.locator('a[href*="/marketplace/item/"]').evaluateAll((as) => as.map((a) => {
    const el = a as HTMLAnchorElement;
    const container = el.closest('[role="listitem"], li, div') as HTMLElement | null;
    return { href: el.href, text: (container?.innerText || el.innerText || '').replace(/\s+/g, ' ').trim() };
  }));
  for (const c of cards) {
    const m = FACEBOOK_LISTING_REGEX.exec(new URL(c.href).pathname);
    if (m?.[1] && bestMatch(l.title, [c.text], 0.8)) return { remoteId: m[1], url: facebookListingUrl(m[1]) };
    if (m?.[1] && c.text.toLowerCase().includes(l.title.toLowerCase())) return { remoteId: m[1], url: facebookListingUrl(m[1]) };
  }
  return null;
}

function itemUrl(ml: MarketplaceListing): string {
  const template = resolveUrl('facebook', 'item', '');
  if (template && ml.remoteId) return template.replace('{id}', ml.remoteId);
  return ml.url ?? (ml.remoteId ? facebookListingUrl(ml.remoteId) : facebookAdapter.urls.home);
}

export const facebookAdapter: BrowserAdapter<FacebookData> = {
  id: 'facebook',
  name: 'Facebook Marketplace',
  kind: 'browser',
  capabilities,
  photoSpec: { maxPhotos: 10, maxLongEdge: 2048, quality: 88 },
  urls: {
    home: 'https://www.facebook.com/marketplace/', sell: 'https://www.facebook.com/marketplace/create/item',
    login: 'https://www.facebook.com/login/', myListings: 'https://www.facebook.com/marketplace/you/selling',
  },
  dataSchema,
  dataFields: [
    ...browserCommonDataFields('Facebook', FACEBOOK_CONDITION_LABELS),
    { key: 'hideFromFriends', label: 'Hide from friends', type: 'boolean' },
  ],
  auth: {
    loginUrl: 'https://www.facebook.com/login/',
    loginUrlPattern: /\/login|checkpoint/i,
    loggedInIndicator: sel.loggedIn,
    challengeIndicator: sel.challenge,
  },
  listingPathRegex: FACEBOOK_LISTING_REGEX,
  selectorGroups,

  validate(l) {
    return l.priceCents !== null && l.priceCents % 100 !== 0
      ? [{ field: 'priceCents', severity: 'warning' as const, message: 'Facebook Marketplace uses whole-dollar prices; the price will be rounded.' }]
      : [];
  },

  describeMapping(l) {
    const rows: Array<{ label: string; value: string }> = [];
    const cond = mapCondition(l, FACEBOOK_CONDITIONS, l.data.conditionOverride);
    if (cond) rows.push({ label: 'Condition', value: cond[0]! });
    const terms = categoryTerms(l);
    if (terms) rows.push({ label: 'Category', value: terms[0]! });
    return rows;
  },

  categoryPath(categoryId) {
    const terms = facebookCategoryTerms(categoryId);
    return terms ? [terms] : null;
  },
  parseListingUrl(url) {
    if (!hostOk(url, FACEBOOK_HOSTS)) return null;
    try {
      const m = FACEBOOK_LISTING_REGEX.exec(new URL(url).pathname);
      return m?.[1] ? { remoteId: m[1], url: facebookListingUrl(m[1]) } : null;
    } catch { return null; }
  },
  listingUrl: facebookListingUrl,

  async connect(ctx) {
    const page = await ctx.page();
    const home = resolveUrl('facebook', 'home', this.urls.home);
    await ctx.step('open', 'Opening Facebook', () => page.goto(home, { waitUntil: 'domcontentloaded' }));
    await ctx.step('login', 'Checking login', () => ensureLoggedIn(ctx, facebookAdapter, page, home));
    return { status: 'connected', accountName: null, message: null };
  },

  async publish(ctx, l) {
    const recipe: BrowserRecipe<FacebookData> = {
      fields: [
        { key: 'photos', label: `Uploading ${l.photoPaths.length} photos`, required: true,
          run: (page) => uploadFiles(page, sel.photoInput, l.photoPaths, { previews: sel.photoPreviews }) },
        { key: 'title', label: 'Filling title', run: (page) => fillText(page, sel.title, l.title) },
        { key: 'price', label: 'Filling price', run: async (page) => {
          if (l.priceCents === null) throw new Error('No price');
          await fillText(page, sel.price, String(Math.round(l.priceCents / 100)));
        } },
        { key: 'category', label: 'Selecting category', run: async (page) => {
          const terms = categoryTerms(l);
          if (!terms) throw new Error('No category mapping');
          let last: unknown;
          for (const term of terms) {
            try { await typeahead(page, sel.categoryInput, term); return; } catch (err) {
              last = err;
              if (!(err instanceof AdapterError && err.code === 'OPTION_NOT_FOUND')) throw err;
            }
          }
          throw last;
        } },
        { key: 'condition', label: 'Selecting condition', run: async (page) => {
          const wanted = mapCondition(l, FACEBOOK_CONDITIONS, l.data.conditionOverride);
          if (wanted) await chooseOption(page, sel.conditionTrigger, wanted);
        } },
        { key: 'description', label: 'Filling description', run: (page) => fillText(page, sel.description, l.description) },
        { key: 'brand', label: 'Filling brand', run: async (page) => { if (l.brand && (await exists(page, sel.brand, 2000))) await fillText(page, sel.brand, l.brand); } },
        { key: 'size', label: 'Selecting size', run: async (page) => {
          if (l.sizeType === 'none' || !l.size || !(await exists(page, sel.size, 2000))) return;
          const control = await page.getByLabel(/^size$/i).first();
          const tag = await control.evaluate((el) => el.tagName);
          if (tag === 'SELECT') await chooseOption(page, sel.size, sizeSynonyms(l.size)); else await fillText(page, sel.size, l.size);
        } },
        { key: 'hideFromFriends', label: 'Hiding from friends', run: async (page) => { if (l.data.hideFromFriends) await setCheckbox(page, sel.hideFromFriends, true); } },
        { key: 'next', label: 'Opening the next page', run: (page) => click(page, sel.next) },
      ],
      submitButton: sel.publish,
      submitLabel: 'Publish',
      detectPublished: async (page, listing, signal) => {
        const direct = waitForUrl(page, FACEBOOK_LISTING_REGEX, signal).then((url) => {
          const m = FACEBOOK_LISTING_REGEX.exec(new URL(url).pathname)!;
          return { remoteId: m[1]!, url: facebookListingUrl(m[1]!) };
        });
        const viaSelling = waitForUrl(page, /\/marketplace\/you\/selling/, signal).then(async () => {
          const found = await findAfterManualPublish(page, listing);
          if (found) return found;
          await pollUntil(signal, async () => false); // can't tell: keep waiting until the user answers
          throw new Error('unreachable');
        });
        return Promise.race([direct, viaSelling]);
      },
      findAfterManualPublish,
    };
    return runBrowserPublish(ctx, facebookAdapter, l, recipe);
  },

  async update(ctx, l, ml) {
    const recipe: UpdateRecipe<FacebookData> = {
      editUrl: (m) => resolveUrl('facebook', 'edit', 'https://www.facebook.com/marketplace/edit/?listing_id={id}').replace('{id}', m.remoteId ?? ''),
      fields: [
        { key: 'title', label: 'Updating title', run: (page) => fillText(page, sel.title, l.title) },
        { key: 'price', label: 'Updating price', run: async (page) => { if (l.priceCents !== null) await fillText(page, sel.price, String(Math.round(l.priceCents / 100))); } },
        { key: 'description', label: 'Updating description', run: (page) => fillText(page, sel.description, l.description) },
      ],
      submitButton: sel.updateSubmit,
      submitLabel: 'Update',
      detectSaved: (page, _l, signal) => pollUntil(signal, async () => !/\/marketplace\/edit/.test(new URL(page.url()).pathname)),
    };
    await runBrowserUpdate(ctx, facebookAdapter, l, ml, recipe);
  },

  async deactivate(ctx, ml) {
    const recipe: DeactivateRecipe = {
      editUrl: itemUrl,
      steps: [
        { key: 'menu', label: 'Opening the listing menu', run: (page) => click(page, sel.listingMenu) },
        { key: 'delete', label: 'Choosing Delete listing', run: (page) => click(page, sel.deleteListing) },
      ],
      confirmButton: sel.deleteConfirm,
      confirmLabel: 'Delete',
      detectDone: (page, _ml, signal) => pollUntil(signal, async () =>
        (await page.getByText(/deleted/i).first().isVisible().catch(() => false)) || !/\/marketplace\/item\//.test(new URL(page.url()).pathname)),
    };
    await runBrowserDeactivate(ctx, facebookAdapter, ml, recipe);
  },
};

