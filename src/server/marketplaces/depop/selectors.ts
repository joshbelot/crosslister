import type { LocatorSpec } from '../../browser/locators';

/** Best-effort and unverified against the live site (06 §4.4) — calibrate with `npm run calibrate -- depop`. */
export const sel = {
  photoInput: { what: 'photo upload', candidates: [{ css: 'input[type="file"]' }] },
  photoPreviews: { what: 'photo previews', candidates: [{ css: '[data-testid*="photo" i] img' }, { css: 'img[src^="blob:"]' }] },
  description: { what: 'Description', candidates: [{ label: /description/i }, { css: 'textarea[name="description"]' }] },
  categoryTrigger: { what: 'Category', candidates: [{ label: /category/i }, { role: 'combobox', name: /category/i }] },
  brand: { what: 'Brand', candidates: [{ label: /brand/i }, { role: 'combobox', name: /brand/i }] },
  conditionTrigger: { what: 'Condition', candidates: [{ label: /condition/i }, { role: 'combobox', name: /condition/i }] },
  sizeTrigger: { what: 'Size', candidates: [{ label: /size/i }, { role: 'combobox', name: /size/i }] },
  colorTrigger: { what: 'Colour', candidates: [{ label: /colou?r/i }] },
  price: { what: 'Price', candidates: [{ label: /^price/i }, { css: 'input[name="priceAmount"]' }] },
  parcelTrigger: { what: 'Parcel size', candidates: [{ label: /parcel size|package size/i }, { role: 'radiogroup', name: /parcel|package/i }] },
  submit: { what: 'Post button', candidates: [{ role: 'button', name: /^(post|list|publish)( item)?$/i }] },
  updateSubmit: { what: 'Save button', candidates: [{ role: 'button', name: /^(save|update)/i }] },
  deleteButton: { what: 'Delete', candidates: [{ role: 'button', name: /^delete( listing)?$/i }] },
  deleteConfirm: {
    what: 'Confirm delete',
    candidates: [{ css: '[role="dialog"] button:text-matches("^(delete|yes)", "i")' }, { role: 'button', name: /^(delete|yes)/i }],
  },
  loggedIn: { what: 'logged-in indicator', candidates: [{ role: 'link', name: /profile|my shop/i }, { css: '[data-testid="navigation__profile"]' }] },
  challenge: { what: 'verification prompt', candidates: [{ text: /verify|verification code|confirm it's you/i }] },
} satisfies Record<string, LocatorSpec>;

export const selectorGroups: Record<'sell' | 'edit' | 'item' | 'home', LocatorSpec[]> = {
  sell: [sel.photoInput, sel.description, sel.categoryTrigger, sel.brand, sel.conditionTrigger, sel.sizeTrigger, sel.colorTrigger, sel.price, sel.parcelTrigger, sel.submit],
  edit: [sel.deleteButton, sel.description, sel.price, sel.updateSubmit],
  item: [],
  home: [sel.loggedIn],
};
