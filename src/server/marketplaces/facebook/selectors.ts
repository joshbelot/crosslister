import type { LocatorSpec } from '../../browser/locators';

/** Best-effort and unverified against the live site (06 §6.4) — calibrate with `npm run calibrate -- facebook`. */
export const sel = {
  photoInput: { what: 'photo upload', candidates: [{ css: 'input[type="file"][accept*="image"]' }, { css: 'input[type="file"]' }] },
  photoPreviews: { what: 'photo previews', candidates: [{ css: 'img[src^="blob:"]' }, { css: '[aria-label*="photo" i] img' }] },
  title: { what: 'Title', candidates: [{ label: /^title$/i }, { role: 'textbox', name: /title/i }] },
  price: { what: 'Price', candidates: [{ label: /^price$/i }, { role: 'textbox', name: /price/i }] },
  categoryInput: { what: 'Category', candidates: [{ label: /^category$/i }, { role: 'combobox', name: /category/i }] },
  conditionTrigger: { what: 'Condition', candidates: [{ label: /^condition$/i }, { role: 'combobox', name: /condition/i }] },
  description: { what: 'Description', candidates: [{ label: /^description$/i }, { role: 'textbox', name: /description/i }] },
  brand: { what: 'Brand', candidates: [{ label: /^brand$/i }] },
  size: { what: 'Size', candidates: [{ label: /^size$/i }] },
  hideFromFriends: { what: 'Hide from friends', candidates: [{ role: 'switch', name: /hide from friends/i }, { label: /hide from friends/i }] },
  next: { what: 'Next button', candidates: [{ role: 'button', name: /^next$/i }] },
  publish: { what: 'Publish button', candidates: [{ role: 'button', name: /^publish$/i }] },
  updateSubmit: { what: 'Update button', candidates: [{ role: 'button', name: /^(update|save)/i }] },
  listingMenu: { what: 'Listing menu', candidates: [{ role: 'button', name: /more|options|…/i }] },
  deleteListing: { what: 'Delete listing', candidates: [{ role: 'menuitem', name: /delete listing/i }, { text: /^delete listing$/i }] },
  deleteConfirm: {
    what: 'Confirm delete',
    candidates: [{ css: '[role="dialog"] button:text-matches("^delete$", "i")' }, { role: 'button', name: /^delete$/i }],
  },
  loggedIn: { what: 'logged-in indicator', candidates: [{ role: 'link', name: /^marketplace$/i }, { role: 'button', name: /your profile|account controls/i }, { css: '[aria-label="Your profile" i]' }] },
  challenge: { what: 'security check prompt', candidates: [{ text: /confirm (it's|that it's) you|security check|checkpoint/i }] },
} satisfies Record<string, LocatorSpec>;

export const selectorGroups: Record<'sell' | 'edit' | 'item' | 'home', LocatorSpec[]> = {
  sell: [sel.photoInput, sel.title, sel.price, sel.categoryInput, sel.conditionTrigger, sel.description, sel.brand, sel.size, sel.hideFromFriends, sel.next, sel.publish],
  edit: [sel.title, sel.price, sel.description, sel.updateSubmit],
  item: [sel.listingMenu, sel.deleteListing],
  home: [sel.loggedIn],
};
