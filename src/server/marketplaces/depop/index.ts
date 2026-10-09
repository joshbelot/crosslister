import type { Page } from 'playwright';
import { z } from 'zod';
import { sizeSynonyms } from '../../../shared/sizes';
import type { MarketplaceCapabilities, MarketplaceListing } from '../../../shared/types';
import { chooseMany, chooseOption, choosePath, chooseRadio, click, fillText, typeahead, uploadFiles } from '../../browser/actions';
import { exists } from '../../browser/locators';
import {
  browserCommonData, browserCommonDataFields, categoryPathFor, detectByUrlOrLink, ensureLoggedIn, hostOk, mapColors, mapCondition,
  pollUntil, resolveCategoryPath, resolveUrl, runBrowserDeactivate, runBrowserPublish, runBrowserUpdate, type BrowserRecipe, type DeactivateRecipe, type UpdateRecipe,
  browserCheckStatus,
} from '../common';
import { createBrowserImporter } from '../../importers/browserImporter';
import type { BrowserAdapter } from '../types';
import {
  DEPOP_COLORS, DEPOP_CONDITIONS, DEPOP_CONDITION_LABELS, DEPOP_HOSTS, DEPOP_LISTING_REGEX, depopCategoryPath, depopHashtagLine,
  depopListingUrl, depopParcelSize,
} from './mapping';
import { sel, selectorGroups } from './selectors';

const dataSchema = z.object({
  ...browserCommonData,
  hashtags: z.array(z.string().regex(/^[a-z0-9]+$/i).max(30)).max(5).default([]),
});
type DepopData = z.infer<typeof dataSchema>;

const capabilities: MarketplaceCapabilities = {
  publish: 'assisted', update: 'assisted', deactivate: 'assisted', statusCheck: 'browser', import: 'browser',
  autoSubmitAllowed: true, maxPhotos: 8, titleMaxLength: null, descriptionMaxLength: 1000, minPriceCents: 100, maxPriceCents: null,
  requires: ['description', 'price', 'condition', 'category', 'size'],
};

function editUrl(ml: MarketplaceListing): string {
  if (!ml.remoteId) return ml.url ?? depopAdapter.urls.home;
  return resolveUrl('depop', 'edit', 'https://www.depop.com/products/edit/{id}/').replace('{id}', ml.remoteId);
}
const onProductPage = (page: Page) => { try { return /\/products\//.test(new URL(page.url()).pathname); } catch { return true; } };

export const depopAdapter: BrowserAdapter<DepopData> = {
  id: 'depop',
  name: 'Depop',
  kind: 'browser',
  capabilities,
  photoSpec: { maxPhotos: 8, maxLongEdge: 1600, quality: 88 },
  urls: { home: 'https://www.depop.com/', sell: 'https://www.depop.com/products/create/', login: 'https://www.depop.com/login/' },
  dataSchema,
  dataFields: [
    ...browserCommonDataFields('Depop', DEPOP_CONDITION_LABELS),
    { key: 'hashtags', label: 'Hashtags', type: 'tags', maxItems: 5, help: 'Letters and numbers only. Empty = the first 5 of your tags.' },
  ],
  auth: {
    loginUrl: 'https://www.depop.com/login/',
    loginUrlPattern: /\/login|\/signup/i,
    loggedInIndicator: sel.loggedIn,
    challengeIndicator: sel.challenge,
  },
  listingPathRegex: DEPOP_LISTING_REGEX,
  selectorGroups,

  /** Depop has no title field: the title becomes the first line, followed by hashtags. */
  finalizeDescription(l) {
    const hashtagLine = depopHashtagLine(l.data.hashtags, l.tags);
    return [l.title, l.description, hashtagLine].filter(Boolean).join('\n\n');
  },

  validate(l) {
    return l.colors.length > 2 ? [{ field: 'colors', severity: 'warning' as const, message: 'Depop accepts up to 2 colors.' }] : [];
  },

  describeMapping(l) {
    const rows: Array<{ label: string; value: string }> = [];
    const cond = mapCondition(l, DEPOP_CONDITIONS, l.data.conditionOverride);
    if (cond) rows.push({ label: 'Condition', value: cond[0]! });
    const path = categoryPathFor(depopAdapter, l);
    if (path) rows.push({ label: 'Category', value: path.map((s) => (Array.isArray(s) ? s[0] : s)).join(' › ') });
    const colors = mapColors(l.colors, DEPOP_COLORS, 2).map((c) => c[0]).join(', ');
    if (colors) rows.push({ label: 'Colors', value: colors });
    const parcel = depopParcelSize(l.shipping.weightOz);
    if (parcel) rows.push({ label: 'Parcel size', value: parcel[0]! });
    return rows;
  },

  categoryPath: depopCategoryPath,
  parseListingUrl(url) {
    if (!hostOk(url, DEPOP_HOSTS)) return null;
    try {
      const m = DEPOP_LISTING_REGEX.exec(new URL(url).pathname);
      return m?.[1] ? { remoteId: m[1], url: depopListingUrl(m[1]) } : null;
    } catch { return null; }
  },
  listingUrl: depopListingUrl,

  async connect(ctx) {
    const page = await ctx.page();
    const home = resolveUrl('depop', 'home', this.urls.home);
    await ctx.step('open', 'Opening Depop', () => page.goto(home, { waitUntil: 'domcontentloaded' }));
    await ctx.step('login', 'Checking login', () => ensureLoggedIn(ctx, depopAdapter, page, home));
    return { status: 'connected', accountName: null, message: null };
  },

  async publish(ctx, l) {
    const recipe: BrowserRecipe<DepopData> = {
      fields: [
        { key: 'photos', label: `Uploading ${l.photoPaths.length} photos`, required: true,
          run: (page) => uploadFiles(page, sel.photoInput, l.photoPaths, { previews: sel.photoPreviews }) },
        { key: 'description', label: 'Filling description', run: (page) => fillText(page, sel.description, l.description) },
        { key: 'category', label: 'Selecting category', run: async (page) => {
          const path = resolveCategoryPath(ctx.db, depopAdapter, l, l.data);
          if (!path) throw new Error('No category mapping');
          try {
            await choosePath(page, sel.categoryTrigger, path);
          } catch (err) {
            // The category control may be a combobox with a search box: type the leaf instead.
            const leaf = path[path.length - 1]!;
            await typeahead(page, sel.categoryTrigger, Array.isArray(leaf) ? leaf[0]! : leaf).catch(() => { throw err; });
          }
        } },
        { key: 'brand', label: 'Selecting brand', run: async (page) => { if (l.brand) await typeahead(page, sel.brand, l.brand, { allowCustom: false }); } },
        { key: 'condition', label: 'Selecting condition', run: async (page) => {
          const wanted = mapCondition(l, DEPOP_CONDITIONS, l.data.conditionOverride);
          if (wanted) await chooseOption(page, sel.conditionTrigger, wanted);
        } },
        { key: 'size', label: 'Selecting size', run: async (page) => {
          if (l.sizeType === 'none' || !l.size || !(await exists(page, sel.sizeTrigger, 2000))) return;
          await chooseOption(page, sel.sizeTrigger, sizeSynonyms(l.size));
        } },
        { key: 'colors', label: 'Selecting colors', run: async (page) => {
          const colors = mapColors(l.colors, DEPOP_COLORS, 2);
          if (colors.length === 0 || !(await exists(page, sel.colorTrigger, 2000))) return;
          await chooseMany(page, sel.colorTrigger, colors);
        } },
        { key: 'price', label: 'Filling price', run: async (page) => {
          if (l.priceCents === null) throw new Error('No price');
          await fillText(page, sel.price, (l.priceCents / 100).toFixed(2));
        } },
        { key: 'shipping', label: 'Choosing parcel size', run: async (page) => {
          const tiers = depopParcelSize(l.shipping.weightOz);
          if (!tiers) throw new Error('No package weight');
          await chooseRadio(page, sel.parcelTrigger, tiers);
        } },
      ],
      submitButton: sel.submit,
      submitLabel: 'Post',
      detectPublished: (page, _l, signal) => detectByUrlOrLink(page, DEPOP_LISTING_REGEX, signal, { successText: /listed|posted|live/i }),
    };
    return runBrowserPublish(ctx, depopAdapter, l, recipe);
  },

  async update(ctx, l, ml) {
    const recipe: UpdateRecipe<DepopData> = {
      editUrl,
      fields: [
        { key: 'description', label: 'Updating description', run: (page) => fillText(page, sel.description, l.description) },
        { key: 'price', label: 'Updating price', run: async (page) => { if (l.priceCents !== null) await fillText(page, sel.price, (l.priceCents / 100).toFixed(2)); } },
      ],
      submitButton: sel.updateSubmit,
      submitLabel: 'Save',
      detectSaved: (page, _l, signal) => pollUntil(signal, async () => !/\/products\/edit\//.test(new URL(page.url()).pathname)),
    };
    await runBrowserUpdate(ctx, depopAdapter, l, ml, recipe);
  },

  async deactivate(ctx, ml) {
    const recipe: DeactivateRecipe = {
      editUrl,
      steps: [{ key: 'delete', label: 'Opening delete', run: (page) => click(page, sel.deleteButton) }],
      confirmButton: sel.deleteConfirm,
      confirmLabel: 'Delete',
      detectDone: (page, _ml, signal) => pollUntil(signal, async () =>
        (await page.getByText(/deleted/i).first().isVisible().catch(() => false)) || !onProductPage(page)),
    };
    await runBrowserDeactivate(ctx, depopAdapter, ml, recipe);
  },
};

// Shop-page + pasted-URL import (07 §5.3). Assisted, uncalibrated.
depopAdapter.importer = createBrowserImporter(depopAdapter as unknown as BrowserAdapter, { shopUrl: (account) => (account ? `https://www.depop.com/${account}/` : null) });
depopAdapter.checkStatus = (ctx, ml) => browserCheckStatus(ctx, depopAdapter as unknown as BrowserAdapter, ml);
