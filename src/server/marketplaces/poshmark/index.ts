import { z } from 'zod';
import { formatCents, formatCentsShort } from '../../../shared/money';
import { sizeSynonyms } from '../../../shared/sizes';
import type { MarketplaceCapabilities, MarketplaceListing, ValidationIssue } from '../../../shared/types';
import { choosePath, chooseMany, chooseOption, click, fillText, typeahead, uploadFiles } from '../../browser/actions';
import { exists } from '../../browser/locators';
import {
  browserCommonData, browserCommonDataFields, categoryPathFor, detectByUrlOrLink, ensureLoggedIn, hostOk, mapColors, mapCondition,
  pollUntil, resolveCategoryPath, resolveUrl, runBrowserDeactivate, runBrowserPublish, runBrowserUpdate, type BrowserRecipe, type DeactivateRecipe, type UpdateRecipe,
  browserCheckStatus,
} from '../common';
import { createBrowserImporter } from '../../importers/browserImporter';
import type { BrowserAdapter, EffectiveListing } from '../types';
import {
  POSHMARK_COLORS, POSHMARK_CONDITIONS, POSHMARK_CONDITION_LABELS, POSHMARK_HOSTS, POSHMARK_LISTING_REGEX, POSHMARK_UNSUPPORTED_DEPARTMENTS,
  poshmarkCategoryPath, poshmarkListingUrl, poshmarkWholeDollars,
} from './mapping';
import { sel, selectorGroups } from './selectors';
import { departmentOf } from '../../../shared/taxonomy';

const dataSchema = z.object({ ...browserCommonData, styleTags: z.array(z.string().max(30)).max(3).default([]) });
type PoshmarkData = z.infer<typeof dataSchema>;

const capabilities: MarketplaceCapabilities = {
  publish: 'assisted', update: 'assisted', deactivate: 'assisted', statusCheck: 'browser', import: 'browser',
  autoSubmitAllowed: true, maxPhotos: 16, titleMaxLength: 80, descriptionMaxLength: 1500, minPriceCents: 300, maxPriceCents: null,
  requires: ['title', 'description', 'price', 'category', 'size', 'msrp'],
};

const styleTagsOf = (l: EffectiveListing<PoshmarkData>) => (l.data.styleTags.length ? l.data.styleTags : l.tags).slice(0, 3);
const leavesEditPage = (page: import('playwright').Page) => { try { return !/\/edit-listing\//.test(new URL(page.url()).pathname); } catch { return false; } };

function editUrl(ml: MarketplaceListing): string {
  if (!ml.remoteId) return ml.url ?? poshmarkAdapter.urls.home;
  return resolveUrl('poshmark', 'edit', 'https://poshmark.com/edit-listing/{id}').replace('{id}', ml.remoteId);
}

export const poshmarkAdapter: BrowserAdapter<PoshmarkData> = {
  id: 'poshmark',
  name: 'Poshmark',
  kind: 'browser',
  capabilities,
  photoSpec: { maxPhotos: 16, maxLongEdge: 2048, quality: 88 },
  urls: { home: 'https://poshmark.com/', sell: 'https://poshmark.com/create-listing', login: 'https://poshmark.com/login' },
  dataSchema,
  dataFields: [
    ...browserCommonDataFields('Poshmark', POSHMARK_CONDITION_LABELS),
    { key: 'styleTags', label: 'Style tags', type: 'tags', maxItems: 3 },
  ],
  auth: {
    loginUrl: 'https://poshmark.com/login',
    loginUrlPattern: /\/login|\/signup/i,
    loggedInIndicator: sel.loggedIn,
    challengeIndicator: sel.challenge,
  },
  listingPathRegex: POSHMARK_LISTING_REGEX,
  selectorGroups,

  async readAccountName(page) {
    const href = await page.getByRole('link', { name: /my closet/i }).first().getAttribute('href').catch(() => null);
    const m = href ? /\/closet\/([^/?#]+)/.exec(href) : null;
    return m?.[1] ?? null;
  },

  validate(l): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (l.categoryId && POSHMARK_UNSUPPORTED_DEPARTMENTS.includes(departmentOf(l.categoryId))) {
      issues.push({ field: 'categoryId', severity: 'error', message: "Poshmark doesn't have a category for this item." });
    }
    if (l.priceCents !== null && l.priceCents % 100 !== 0) {
      issues.push({ field: 'priceCents', severity: 'warning', message: `Poshmark uses whole-dollar prices; ${formatCents(l.priceCents)} will be listed as ${formatCentsShort(poshmarkWholeDollars(l.priceCents) * 100)}.` });
    }
    if (l.colors.includes('multicolor')) {
      issues.push({ field: 'colors', severity: 'warning', message: 'Poshmark has no "Multicolor" mapping here — that color will be left empty.' });
    }
    return issues;
  },

  describeMapping(l) {
    const rows: Array<{ label: string; value: string }> = [];
    const cond = mapCondition(l, POSHMARK_CONDITIONS, l.data.conditionOverride);
    if (cond) rows.push({ label: 'Condition', value: cond[0]! });
    const path = categoryPathFor(poshmarkAdapter, l);
    if (path) rows.push({ label: 'Category', value: path.map((s) => (Array.isArray(s) ? s[0] : s)).join(' › ') });
    const colors = mapColors(l.colors, POSHMARK_COLORS, 2).map((c) => c[0]).join(', ');
    if (colors) rows.push({ label: 'Colors', value: colors });
    const tags = styleTagsOf(l);
    if (tags.length) rows.push({ label: 'Style tags', value: tags.join(', ') });
    return rows;
  },

  categoryPath: poshmarkCategoryPath,
  parseListingUrl(url) {
    if (!hostOk(url, POSHMARK_HOSTS)) return null;
    try {
      const m = POSHMARK_LISTING_REGEX.exec(new URL(url).pathname);
      return m?.[1] ? { remoteId: m[1], url } : null;
    } catch { return null; }
  },
  listingUrl: poshmarkListingUrl,

  async connect(ctx) {
    const page = await ctx.page();
    const home = resolveUrl('poshmark', 'home', this.urls.home);
    await ctx.step('open', 'Opening Poshmark', () => page.goto(home, { waitUntil: 'domcontentloaded' }));
    await ctx.step('login', 'Checking login', () => ensureLoggedIn(ctx, poshmarkAdapter, page, home));
    return { status: 'connected', accountName: await poshmarkAdapter.readAccountName!(page), message: null };
  },

  async publish(ctx, l) {
    const recipe: BrowserRecipe<PoshmarkData> = {
      fields: [
        { key: 'photos', label: `Uploading ${l.photoPaths.length} photos`, required: true,
          run: (page) => uploadFiles(page, sel.photoInput, l.photoPaths, { previews: sel.photoPreviews }) },
        { key: 'title', label: 'Filling title', run: (page) => fillText(page, sel.title, l.title) },
        { key: 'description', label: 'Filling description', run: (page) => fillText(page, sel.description, l.description) },
        { key: 'category', label: 'Selecting category', run: async (page) => {
          const path = resolveCategoryPath(ctx.db, poshmarkAdapter, l, l.data);
          if (!path) throw new Error('No category mapping');
          await choosePath(page, sel.categoryTrigger, path);
        } },
        { key: 'size', label: 'Selecting size', run: async (page) => {
          if (l.sizeType === 'none' || !l.size) return;
          await chooseOption(page, sel.sizeTrigger, sizeSynonyms(l.size));
        } },
        { key: 'condition', label: 'Selecting condition', run: async (page) => {
          const wanted = mapCondition(l, POSHMARK_CONDITIONS, l.data.conditionOverride);
          if (wanted) await chooseOption(page, sel.conditionTrigger, wanted);
        } },
        { key: 'brand', label: 'Selecting brand', run: async (page) => { if (l.brand) await typeahead(page, sel.brand, l.brand, { allowCustom: true }); } },
        { key: 'colors', label: 'Selecting colors', run: async (page) => {
          const colors = mapColors(l.colors, POSHMARK_COLORS, 2);
          if (colors.length === 0 || !(await exists(page, sel.colorTrigger, 2000))) return;
          await chooseMany(page, sel.colorTrigger, colors, { doneButton: sel.colorDone });
        } },
        { key: 'styleTags', label: 'Adding style tags', run: async (page) => {
          for (const tag of styleTagsOf(l)) {
            await fillText(page, sel.styleTagInput, tag);
            await page.keyboard.press('Enter');
          }
        } },
        { key: 'originalPrice', label: 'Filling original price', run: async (page) => {
          if (l.msrpCents === null) throw new Error('No original price');
          await fillText(page, sel.originalPrice, String(poshmarkWholeDollars(l.msrpCents)));
        } },
        { key: 'listingPrice', label: 'Filling listing price', run: async (page) => {
          if (l.priceCents === null) throw new Error('No price');
          await fillText(page, sel.listingPrice, String(poshmarkWholeDollars(l.priceCents)));
        } },
        { key: 'next', label: 'Opening review page', run: (page) => click(page, sel.next) },
      ],
      submitButton: sel.submit,
      submitLabel: 'List',
      detectPublished: (page, _l, signal) => detectByUrlOrLink(page, /\/listing\/(?:[^/]*-)?([a-f0-9]{24})/, signal, { successText: /listed|share/i }),
    };
    return runBrowserPublish(ctx, poshmarkAdapter, l, recipe);
  },

  async update(ctx, l, ml) {
    const recipe: UpdateRecipe<PoshmarkData> = {
      editUrl,
      fields: [
        { key: 'title', label: 'Updating title', run: (page) => fillText(page, sel.title, l.title) },
        { key: 'description', label: 'Updating description', run: (page) => fillText(page, sel.description, l.description) },
        { key: 'price', label: 'Updating price', run: async (page) => { if (l.priceCents !== null) await fillText(page, sel.listingPrice, String(poshmarkWholeDollars(l.priceCents))); } },
      ],
      submitButton: sel.update,
      submitLabel: 'Update',
      detectSaved: (page, _l, signal) => pollUntil(signal, async () => leavesEditPage(page)),
    };
    await runBrowserUpdate(ctx, poshmarkAdapter, l, ml, recipe);
  },

  async deactivate(ctx, ml) {
    let mode: 'availability' | 'delete' = 'availability';
    const recipe: DeactivateRecipe = {
      editUrl,
      steps: [{
        key: 'availability', label: 'Setting the listing to Not For Sale',
        run: async (page) => {
          try {
            await chooseOption(page, sel.availabilityTrigger, ['Not For Sale']);
            mode = 'availability';
          } catch {
            await click(page, sel.deleteListing);
            mode = 'delete';
          }
        },
      }],
      get confirmButton() { return mode === 'delete' ? sel.deleteConfirm : sel.update; },
      get confirmLabel() { return mode === 'delete' ? 'Yes' : 'Update'; },
      detectDone: (page, _ml, signal) => pollUntil(signal, async () => leavesEditPage(page)),
    };
    await runBrowserDeactivate(ctx, poshmarkAdapter, ml, recipe);
  },
};

// Shop-page + pasted-URL import (07 §5.3). Assisted, uncalibrated.
poshmarkAdapter.importer = createBrowserImporter(poshmarkAdapter as unknown as BrowserAdapter, { shopUrl: (account) => (account ? `https://poshmark.com/closet/${account}` : null) });
poshmarkAdapter.checkStatus = (ctx, ml) => browserCheckStatus(ctx, poshmarkAdapter as unknown as BrowserAdapter, ml);
