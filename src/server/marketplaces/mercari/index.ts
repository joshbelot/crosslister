import { z } from 'zod';
import { formatWeight } from '../../../shared/text';
import { sizeSynonyms } from '../../../shared/sizes';
import type { MarketplaceCapabilities, MarketplaceListing, ValidationIssue } from '../../../shared/types';
import { choosePath, chooseOption, chooseRadio, click, fillText, typeahead, uploadFiles } from '../../browser/actions';
import { exists } from '../../browser/locators';
import {
  browserCommonData, browserCommonDataFields, categoryPathFor, detectByUrlOrLink, ensureLoggedIn, hostOk, mapColors, mapCondition,
  pollUntil, resolveCategoryPath, resolveUrl, runBrowserDeactivate, runBrowserPublish, runBrowserUpdate, type BrowserRecipe, type DeactivateRecipe, type UpdateRecipe,
} from '../common';
import type { BrowserAdapter, EffectiveListing } from '../types';
import {
  MERCARI_COLORS, MERCARI_CONDITIONS, MERCARI_CONDITION_LABELS, MERCARI_HOSTS, MERCARI_LISTING_REGEX, mercariCategoryPath,
  mercariListingUrl, mercariShippingWeight,
} from './mapping';
import { sel, selectorGroups } from './selectors';

const dataSchema = z.object({ ...browserCommonData, shippingPayer: z.enum(['buyer', 'seller']).optional() });
type MercariData = z.infer<typeof dataSchema>;

const capabilities: MarketplaceCapabilities = {
  publish: 'assisted', update: 'assisted', deactivate: 'assisted', statusCheck: 'browser', import: 'browser',
  autoSubmitAllowed: true, maxPhotos: 12, titleMaxLength: 80, descriptionMaxLength: 1000, minPriceCents: 100, maxPriceCents: 200000,
  requires: ['title', 'description', 'price', 'condition', 'category', 'shippingWeight'],
};

const payerOf = (l: EffectiveListing<MercariData>) => l.data.shippingPayer ?? l.shipping.whoPays;
const priceText = (cents: number) => (cents / 100).toFixed(2);

function editUrl(ml: MarketplaceListing): string {
  if (!ml.remoteId) return ml.url ?? mercariAdapter.urls.home;
  return resolveUrl('mercari', 'edit', 'https://www.mercari.com/sell/edit/{id}/').replace('{id}', ml.remoteId);
}

export const mercariAdapter: BrowserAdapter<MercariData> = {
  id: 'mercari',
  name: 'Mercari',
  kind: 'browser',
  capabilities,
  photoSpec: { maxPhotos: 12, maxLongEdge: 2048, quality: 88 },
  urls: { home: 'https://www.mercari.com/', sell: 'https://www.mercari.com/sell/', login: 'https://www.mercari.com/login/' },
  dataSchema,
  dataFields: [
    ...browserCommonDataFields('Mercari', MERCARI_CONDITION_LABELS),
    { key: 'shippingPayer', label: 'Who pays shipping on Mercari', type: 'select', options: [{ value: 'buyer', label: 'Buyer' }, { value: 'seller', label: 'Seller' }] },
  ],
  auth: {
    loginUrl: 'https://www.mercari.com/login/',
    loginUrlPattern: /\/(login|signin|signup)/i,
    loggedInIndicator: sel.loggedIn,
    challengeIndicator: sel.challenge,
  },
  listingPathRegex: MERCARI_LISTING_REGEX,
  selectorGroups,

  validate(l): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (l.colors.includes('multicolor')) {
      issues.push({ field: 'colors', severity: 'warning', message: 'Mercari has no "Multicolor" option — color will be left empty.' });
    }
    return issues;
  },

  describeMapping(l) {
    const rows: Array<{ label: string; value: string }> = [];
    const cond = mapCondition(l, MERCARI_CONDITIONS, l.data.conditionOverride);
    if (cond) rows.push({ label: 'Condition', value: cond[0]! });
    const path = categoryPathFor(mercariAdapter, l);
    if (path) rows.push({ label: 'Category', value: path.map((s) => (Array.isArray(s) ? s[0] : s)).join(' › ') });
    const colors = mapColors(l.colors, MERCARI_COLORS, 1).map((c) => c[0]).join(', ');
    if (colors) rows.push({ label: 'Colors', value: colors });
    if (l.shipping.weightOz !== null) {
      const w = mercariShippingWeight(l.shipping.weightOz);
      rows.push({ label: 'Shipping weight', value: formatWeight(w.lb * 16 + w.oz) });
    }
    return rows;
  },

  categoryPath: mercariCategoryPath,
  parseListingUrl(url) {
    if (!hostOk(url, MERCARI_HOSTS)) return null;
    try {
      const m = MERCARI_LISTING_REGEX.exec(new URL(url).pathname);
      return m?.[1] ? { remoteId: m[1], url: mercariListingUrl(m[1]) } : null;
    } catch { return null; }
  },
  listingUrl: mercariListingUrl,

  async connect(ctx) {
    const page = await ctx.page();
    const home = resolveUrl('mercari', 'home', this.urls.home);
    await ctx.step('open', 'Opening Mercari', () => page.goto(home, { waitUntil: 'domcontentloaded' }));
    await ctx.step('login', 'Checking login', () => ensureLoggedIn(ctx, mercariAdapter, page, home));
    return { status: 'connected', accountName: null, message: null };
  },

  async publish(ctx, l) {
    const recipe: BrowserRecipe<MercariData> = {
      fields: [
        { key: 'photos', label: `Uploading ${l.photoPaths.length} photos`, required: true,
          run: (page) => uploadFiles(page, sel.photoInput, l.photoPaths, { previews: sel.photoPreviews }) },
        { key: 'title', label: 'Filling title', run: (page) => fillText(page, sel.title, l.title) },
        { key: 'description', label: 'Filling description', run: (page) => fillText(page, sel.description, l.description) },
        { key: 'category', label: 'Selecting category', run: async (page) => {
          const path = resolveCategoryPath(ctx.db, mercariAdapter, l, l.data);
          if (!path) throw new Error('No category mapping');
          await choosePath(page, sel.categoryTrigger, path);
        } },
        { key: 'brand', label: 'Selecting brand', run: async (page) => { if (l.brand) await typeahead(page, sel.brand, l.brand, { allowCustom: false }); } },
        { key: 'condition', label: 'Selecting condition', run: async (page) => {
          const wanted = mapCondition(l, MERCARI_CONDITIONS, l.data.conditionOverride);
          if (wanted) await chooseRadio(page, sel.conditionGroup, wanted);
        } },
        { key: 'size', label: 'Selecting size', run: async (page) => {
          if (l.sizeType === 'none' || !l.size || !(await exists(page, sel.sizeTrigger, 2000))) return;
          await chooseOption(page, sel.sizeTrigger, sizeSynonyms(l.size));
        } },
        { key: 'color', label: 'Selecting color', run: async (page) => {
          const colors = mapColors(l.colors, MERCARI_COLORS, 1);
          if (colors.length === 0 || !(await exists(page, sel.colorTrigger, 2000))) return;
          await chooseOption(page, sel.colorTrigger, colors[0]!);
        } },
        { key: 'shipping', label: 'Setting shipping weight', run: async (page) => {
          if (l.shipping.weightOz === null) throw new Error('No package weight');
          const w = mercariShippingWeight(l.shipping.weightOz);
          await fillText(page, sel.weightLb, String(w.lb));
          await fillText(page, sel.weightOz, String(w.oz));
          await chooseRadio(page, sel.shippingPayerGroup, payerOf(l) === 'buyer' ? ['Buyer', 'The buyer'] : ["I'll pay", 'Seller', 'Me']);
        } },
        { key: 'price', label: 'Filling price', run: async (page) => {
          if (l.priceCents === null) throw new Error('No price');
          await fillText(page, sel.price, priceText(l.priceCents));
          if (await exists(page, sel.smartPricingToggle, 800)) {
            const toggle = page.getByRole('switch', { name: /smart pricing/i }).first();
            if ((await toggle.count()) && (await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
          }
        } },
      ],
      submitButton: sel.submit,
      submitLabel: 'List',
      detectPublished: (page, _l, signal) => detectByUrlOrLink(page, MERCARI_LISTING_REGEX, signal, { successText: /listed|is live|congrat/i }),
    };
    return runBrowserPublish(ctx, mercariAdapter, l, recipe);
  },

  async update(ctx, l, ml) {
    const recipe: UpdateRecipe<MercariData> = {
      editUrl,
      fields: [
        { key: 'title', label: 'Updating title', run: (page) => fillText(page, sel.title, l.title) },
        { key: 'description', label: 'Updating description', run: (page) => fillText(page, sel.description, l.description) },
        { key: 'price', label: 'Updating price', run: async (page) => { if (l.priceCents !== null) await fillText(page, sel.price, priceText(l.priceCents)); } },
      ],
      submitButton: sel.updateSubmit,
      submitLabel: 'Update',
      detectSaved: (page, _l, signal) => pollUntil(signal, async () => !/\/sell\/edit\//.test(new URL(page.url()).pathname)),
    };
    await runBrowserUpdate(ctx, mercariAdapter, l, ml, recipe);
  },

  async deactivate(ctx, ml) {
    const recipe: DeactivateRecipe = {
      editUrl,
      steps: [{ key: 'deactivate', label: 'Opening deactivate', run: (page) => click(page, sel.deactivateButton) }],
      confirmButton: sel.deactivateConfirm,
      confirmLabel: 'Deactivate',
      detectDone: (page, _ml, signal) => pollUntil(signal, async () =>
        (await page.getByText(/deactivated|inactive/i).first().isVisible().catch(() => false)) || !(await exists(page, sel.deactivateButton, 400))),
    };
    await runBrowserDeactivate(ctx, mercariAdapter, ml, recipe);
  },
};

