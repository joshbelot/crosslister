import type { LocatorSpec } from '../../browser/locators';

/** Best-effort and unverified against the live site (06 §7.3) — calibrate with `npm run calibrate -- grailed`. */
export const sel = {
  photoInput: { what: 'photo upload', candidates: [{ css: 'input[type="file"]' }] },
  photoPreviews: { what: 'photo previews', candidates: [{ css: '[data-testid*="photo" i] img' }, { css: 'img[src^="blob:"]' }] },
  category: { what: 'Department / category', candidates: [{ role: 'combobox', name: /department|category/i }, { label: /category/i }] },
  designer: { what: 'Designer', candidates: [{ label: /designer/i }, { placeholder: /designer/i }] },
  size: { what: 'Size', candidates: [{ label: /^size/i }, { role: 'combobox', name: /size/i }] },
  title: { what: 'Item name', candidates: [{ label: /item name|title/i }, { placeholder: /item name/i }] },
  color: { what: 'Color', candidates: [{ label: /colou?r/i }] },
  condition: { what: 'Condition', candidates: [{ label: /condition/i }, { role: 'combobox', name: /condition/i }] },
  description: { what: 'Description', candidates: [{ label: /description/i }] },
  price: { what: 'Price', candidates: [{ label: /^price/i }] },
  submit: { what: 'Publish button', candidates: [{ role: 'button', name: /^(publish|list item|submit)$/i }] },
  updateSubmit: { what: 'Save button', candidates: [{ role: 'button', name: /^(save|update|publish)/i }] },
  deleteButton: { what: 'Delete listing', candidates: [{ role: 'button', name: /^delete( listing)?$/i }] },
  deleteConfirm: {
    what: 'Confirm delete',
    candidates: [{ css: '[role="dialog"] button:text-matches("^(delete|yes|confirm)", "i")' }, { role: 'button', name: /^(delete|yes|confirm)/i }],
  },
  loggedIn: { what: 'logged-in indicator', candidates: [{ role: 'link', name: /my items|profile|account/i }, { css: '[data-testid*="avatar" i]' }] },
  challenge: { what: 'verification prompt', candidates: [{ text: /verify|verification code|confirm it's you/i }] },
} satisfies Record<string, LocatorSpec>;

export const selectorGroups: Record<'sell' | 'edit' | 'item' | 'home', LocatorSpec[]> = {
  sell: [sel.photoInput, sel.category, sel.designer, sel.size, sel.title, sel.color, sel.condition, sel.description, sel.price, sel.submit],
  edit: [sel.deleteButton, sel.title, sel.description, sel.price, sel.updateSubmit],
  item: [],
  home: [sel.loggedIn],
};
