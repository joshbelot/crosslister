import { z } from 'zod';
import { COLORS } from '../../../shared/colors';
import { departmentOf } from '../../../shared/taxonomy';
import { sizeSynonyms } from '../../../shared/sizes';
import type { MarketplaceCapabilities, MarketplaceListing, ValidationIssue } from '../../../shared/types';
import { chooseOption, choosePath, click, fillText, typeahead, uploadFiles } from '../../browser/actions';
import { exists } from '../../browser/locators';
import {
  browserCommonData, browserCommonDataFields, categoryPathFor, detectByUrlOrLink, ensureLoggedIn, hostOk, mapCondition, pollUntil,
  resolveCategoryPath, resolveUrl, runBrowserDeactivate, runBrowserPublish, type BrowserRecipe, type DeactivateRecipe,
} from '../common';
import type { BrowserAdapter } from '../types';
import {
  GRAILED_CONDITIONS, GRAILED_CONDITION_LABELS, GRAILED_DEPARTMENTS, GRAILED_HOSTS, GRAILED_LISTING_REGEX, grailedCategoryPath,
  grailedListingUrl, grailedNeedsSubcategory,
} from './mapping';
import { sel, selectorGroups } from './selectors';

const dataSchema = z.object({ ...browserCommonData });
type GrailedData = z.infer<typeof dataSchema>;

const capabilities: MarketplaceCapabilities = {
  publish: 'assisted', update: 'assisted', deactivate: 'assisted', statusCheck: 'browser', import: 'browser',
  autoSubmitAllowed: true, maxPhotos: 8, titleMaxLength: 60, descriptionMaxLength: 1000, minPriceCents: 100, maxPriceCents: null,
  requires: ['title', 'price', 'condition', 'category', 'brand', 'size', 'description'],
};

const EDIT_PATH = /\/listings\/\d+(?:-[^/]*)?\/edit/;
const parseId = (url: string): string | null => {
  try {
    const p = new URL(url).pathname;
    if (EDIT_PATH.test(p) || /\/edit\/?$/.test(p)) return null;
    return GRAILED_LISTING_REGEX.exec(p)?.[1] ?? null;
  } catch { return null; }
};

function editUrl(ml: MarketplaceListing): string {
  if (!ml.remoteId) return ml.url ?? grailedAdapter.urls.home;
  return resolveUrl('grailed', 'edit', 'https://www.grailed.com/listings/{id}/edit').replace('{id}', ml.remoteId);
}

export const grailedAdapter: BrowserAdapter<GrailedData> = {
  id: 'grailed',
  name: 'Grailed',
  kind: 'browser',
  capabilities,
  photoSpec: { maxPhotos: 8, maxLongEdge: 2048, quality: 88 },
  urls: { home: 'https://www.grailed.com/', sell: 'https://www.grailed.com/sell/new', login: 'https://www.grailed.com/users/sign_up' },
  dataSchema,
  dataFields: browserCommonDataFields('Grailed', GRAILED_CONDITION_LABELS),
  auth: {
    loginUrl: 'https://www.grailed.com/users/sign_up',
    loginUrlPattern: /sign_up|sign_in|login/i,
    loggedInIndicator: sel.loggedIn,
    challengeIndicator: sel.challenge,
  },
  listingPathRegex: GRAILED_LISTING_REGEX,
  selectorGroups,

  validate(l): ValidationIssue[] {
    if (l.categoryId && !GRAILED_DEPARTMENTS.includes(departmentOf(l.categoryId))) {
      return [{ field: 'categoryId', severity: 'error', message: 'Grailed only accepts menswear and womenswear.' }];
    }
    return [];
  },

  describeMapping(l) {
    const rows: Array<{ label: string; value: string }> = [];
    const cond = mapCondition(l, GRAILED_CONDITIONS, l.data.conditionOverride);
    if (cond) rows.push({ label: 'Condition', value: cond[0]! });
    const path = categoryPathFor(grailedAdapter, l);
    if (path) rows.push({ label: 'Category', value: path.map((s) => (Array.isArray(s) ? s[0] : s)).join(' › ') });
    return rows;
  },

  categoryPath: grailedCategoryPath,
  parseListingUrl(url) {
    if (!hostOk(url, GRAILED_HOSTS)) return null;
    const id = parseId(url);
    return id ? { remoteId: id, url: grailedListingUrl(id) } : null;
  },
  listingUrl: grailedListingUrl,

  async connect(ctx) {
    const page = await ctx.page();
    const home = resolveUrl('grailed', 'home', this.urls.home);
    await ctx.step('open', 'Opening Grailed', () => page.goto(home, { waitUntil: 'domcontentloaded' }));
    await ctx.step('login', 'Checking login', () => ensureLoggedIn(ctx, grailedAdapter, page, home));
    return { status: 'connected', accountName: null, message: null };
  },

  async publish(ctx, l) {
    const recipe: BrowserRecipe<GrailedData> = {
      fields: [
        { key: 'photos', label: `Uploading ${l.photoPaths.length} photos`, required: true,
          run: (page) => uploadFiles(page, sel.photoInput, l.photoPaths, { previews: sel.photoPreviews }) },
        { key: 'category', label: 'Selecting category', run: async (page) => {
          const path = resolveCategoryPath(ctx.db, grailedAdapter, l, l.data);
          if (!path) throw new Error('No category mapping');
          await choosePath(page, sel.category, path);
        } },
        ...(grailedNeedsSubcategory(l.categoryId)
          ? [{ key: 'subcategory', label: 'Choosing subcategory', run: async () => { throw new Error("Womenswear subcategories are chosen by you"); } }]
          : []),
        { key: 'designer', label: 'Selecting designer', run: async (page) => { if (l.brand) await typeahead(page, sel.designer, l.brand, { allowCustom: false }); } },
        { key: 'size', label: 'Selecting size', run: async (page) => {
          if (!l.size) return;
          await chooseOption(page, sel.size, sizeSynonyms(l.size));
        } },
        { key: 'title', label: 'Filling title', run: (page) => fillText(page, sel.title, l.title) },
        { key: 'color', label: 'Selecting color', run: async (page) => {
          const first = l.colors[0];
          if (!first || !(await exists(page, sel.color, 2000))) return;
          await chooseOption(page, sel.color, COLORS.find((c) => c.id === first)?.label ?? first);
        } },
        { key: 'condition', label: 'Selecting condition', run: async (page) => {
          const wanted = mapCondition(l, GRAILED_CONDITIONS, l.data.conditionOverride);
          if (wanted) await chooseOption(page, sel.condition, wanted);
        } },
        { key: 'description', label: 'Filling description', run: (page) => fillText(page, sel.description, l.description) },
        { key: 'price', label: 'Filling price', run: async (page) => {
          if (l.priceCents === null) throw new Error('No price');
          await fillText(page, sel.price, (l.priceCents / 100).toFixed(0));
        } },
      ],
      submitButton: sel.submit,
      submitLabel: 'Publish',
      detectPublished: async (page, _l, signal) => {
        const found = await detectByUrlOrLink(page, /\/listings\/(\d+)(?:-[^/]*)?\/?$/, signal);
        return { remoteId: found.remoteId, url: found.url };
      },
    };
    return runBrowserPublish(ctx, grailedAdapter, l, recipe);
  },

  async deactivate(ctx, ml) {
    const recipe: DeactivateRecipe = {
      editUrl,
      steps: [{ key: 'delete', label: 'Opening delete', run: (page) => click(page, sel.deleteButton) }],
      confirmButton: sel.deleteConfirm,
      confirmLabel: 'Delete',
      detectDone: (page, _ml, signal) => pollUntil(signal, async () =>
        (await page.getByText(/deleted|removed/i).first().isVisible().catch(() => false)) || !/\/listings\//.test(new URL(page.url()).pathname)),
    };
    await runBrowserDeactivate(ctx, grailedAdapter, ml, recipe);
  },
};
