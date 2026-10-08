import type { LocatorSpec } from '../../browser/locators';

/** Every selector is best-effort and unverified against the live site (06 §2.4) — calibrate with `npm run calibrate -- mercari`. */
export const sel = {
  photoInput: { what: 'photo upload', candidates: [{ css: 'input[type="file"][accept*="image"]' }, { css: 'input[type="file"]' }] },
  photoPreviews: { what: 'photo previews', candidates: [{ css: '[data-testid*="Photo" i] img' }, { css: 'img[src^="blob:"]' }] },
  title: { what: 'Title', candidates: [{ label: /^title/i }, { placeholder: /what are you selling|title/i }, { testId: 'Title' }, { css: 'input[name="name"]' }] },
  description: { what: 'Description', candidates: [{ label: /^description/i }, { placeholder: /describe|description/i }, { testId: 'Description' }, { css: 'textarea' }] },
  categoryTrigger: { what: 'Category', candidates: [{ role: 'button', name: /category/i }, { label: /category/i }, { testId: 'CategoryL0' }] },
  brand: { what: 'Brand', candidates: [{ label: /^brand/i }, { placeholder: /brand/i }, { testId: 'Brand' }] },
  conditionGroup: { what: 'Condition', candidates: [{ role: 'radiogroup', name: /condition/i }, { testId: 'Condition' }, { css: '[aria-label*="condition" i]' }] },
  colorTrigger: { what: 'Color', candidates: [{ role: 'button', name: /color/i }, { label: /color/i }] },
  sizeTrigger: { what: 'Size', candidates: [{ role: 'button', name: /^size/i }, { label: /^size/i }] },
  weightLb: { what: 'Weight (lb)', candidates: [{ label: /\blb\b|pounds/i }, { placeholder: /lb/i }] },
  weightOz: { what: 'Weight (oz)', candidates: [{ label: /\boz\b|ounces/i }, { placeholder: /oz/i }] },
  shippingPayerGroup: { what: 'Who pays shipping', candidates: [{ role: 'radiogroup', name: /who pays|shipping/i }] },
  price: { what: 'Price', candidates: [{ label: /^(listing )?price/i }, { placeholder: /\$|price/i }, { testId: 'Price' }] },
  smartPricingToggle: { what: 'Smart pricing', candidates: [{ role: 'switch', name: /smart pricing/i }, { label: /smart pricing/i }] },
  submit: { what: 'List button', candidates: [{ role: 'button', name: /^list$/i }, { role: 'button', name: /^list (item|now)$/i }, { testId: 'ListButton' }] },
  updateSubmit: { what: 'Update button', candidates: [{ role: 'button', name: /^(update|save)/i }] },
  // edit / deactivate
  deactivateButton: { what: 'Deactivate', candidates: [{ role: 'button', name: /^deactivate/i }, { text: /^deactivate/i }] },
  // the confirmation lives inside a dialog; dialog-scoped candidates come first so the page's own Deactivate button isn't clicked again
  deactivateConfirm: {
    what: 'Confirm deactivate',
    candidates: [
      { css: '[role="dialog"] button:text-matches("^(deactivate|yes|confirm)", "i")' },
      { css: 'dialog button:text-matches("^(deactivate|yes|confirm)", "i")' },
      { role: 'button', name: /^(deactivate|yes|confirm)/i },
    ],
  },
  loggedIn: { what: 'logged-in indicator', candidates: [{ role: 'link', name: /my page|profile|account/i }, { role: 'button', name: /account|profile/i }, { css: '[data-testid*="Avatar" i]' }] },
  challenge: { what: 'verification prompt', candidates: [{ text: /verify|verification code|confirm it's you/i }] },
} satisfies Record<string, LocatorSpec>;

export const selectorGroups: Record<'sell' | 'edit' | 'item' | 'home', LocatorSpec[]> = {
  sell: [sel.photoInput, sel.title, sel.description, sel.categoryTrigger, sel.brand, sel.conditionGroup, sel.colorTrigger, sel.sizeTrigger,
    sel.weightLb, sel.weightOz, sel.shippingPayerGroup, sel.price, sel.smartPricingToggle, sel.submit],
  edit: [sel.deactivateButton, sel.title, sel.description, sel.price, sel.updateSubmit],
  item: [],
  home: [sel.loggedIn],
};
