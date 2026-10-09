import type { LocatorSpec } from '../../browser/locators';

/** Best-effort and unverified against the live site (06 §3.4) — calibrate with `npm run calibrate -- poshmark`. */
export const sel = {
  photoInput: { what: 'photo upload', candidates: [{ css: 'input[type="file"][accept*="image"]' }, { css: 'input[type="file"]' }] },
  photoPreviews: { what: 'photo previews', candidates: [{ css: '.listing-editor__image img' }, { css: 'img[src^="blob:"]' }, { css: '[data-test*="image-tile" i] img' }] },
  title: { what: 'Title', candidates: [{ placeholder: /what are you selling/i }, { label: /title/i }, { css: 'input[data-vv-name="title"]' }] },
  description: { what: 'Description', candidates: [{ placeholder: /describe it/i }, { label: /description/i }, { css: 'textarea[data-vv-name="description"]' }] },
  categoryTrigger: { what: 'Category', candidates: [{ text: /^select category$/i }, { role: 'button', name: /category/i }, { css: '[data-et-name="category"]' }] },
  sizeTrigger: { what: 'Size', candidates: [{ text: /^select size$/i }, { role: 'button', name: /size/i }] },
  conditionTrigger: { what: 'Condition', candidates: [{ role: 'button', name: /condition/i }, { label: /condition/i }] },
  brand: { what: 'Brand', candidates: [{ placeholder: /enter the brand|brand/i }, { label: /brand/i }] },
  colorTrigger: { what: 'Color', candidates: [{ role: 'button', name: /color/i }, { text: /^color$/i }] },
  colorDone: { what: 'Color Done button', candidates: [{ role: 'button', name: /^done$/i }] },
  styleTagInput: { what: 'Style tags', candidates: [{ placeholder: /style tag/i }, { label: /style tags?/i }] },
  originalPrice: { what: 'Original price', candidates: [{ label: /original price/i }, { placeholder: /original price/i }, { css: 'input[data-vv-name="originalPrice"]' }] },
  listingPrice: { what: 'Listing price', candidates: [{ label: /listing price/i }, { placeholder: /listing price/i }, { css: 'input[data-vv-name="listingPrice"]' }] },
  next: { what: 'Next button', candidates: [{ role: 'button', name: /^next$/i }] },
  submit: { what: 'List button', candidates: [{ role: 'button', name: /^list( this item)?$/i }] },
  // edit page
  availabilityTrigger: { what: 'Availability', candidates: [{ label: /availability/i }, { role: 'button', name: /availability|for sale/i }] },
  update: { what: 'Update button', candidates: [{ role: 'button', name: /^update$/i }] },
  deleteListing: { what: 'Delete listing', candidates: [{ role: 'button', name: /^delete listing$/i }, { text: /^delete listing$/i }] },
  deleteConfirm: {
    what: 'Confirm delete',
    candidates: [{ css: '[role="dialog"] button:text-matches("^(yes|delete)$", "i")' }, { role: 'button', name: /^(yes|delete)$/i }],
  },
  loggedIn: { what: 'logged-in indicator', candidates: [{ role: 'link', name: /my closet/i }, { css: '[data-et-name="profile"]' }, { css: 'img.user-image' }] },
  myClosetLink: { what: 'My Closet link', candidates: [{ role: 'link', name: /my closet/i }] },
  challenge: { what: 'verification prompt', candidates: [{ text: /verify|verification code|confirm it's you/i }] },
} satisfies Record<string, LocatorSpec>;

export const selectorGroups: Record<'sell' | 'edit' | 'item' | 'home', LocatorSpec[]> = {
  sell: [sel.photoInput, sel.title, sel.description, sel.categoryTrigger, sel.sizeTrigger, sel.conditionTrigger, sel.brand, sel.colorTrigger,
    sel.styleTagInput, sel.originalPrice, sel.listingPrice, sel.next],
  edit: [sel.availabilityTrigger, sel.update, sel.deleteListing, sel.title, sel.description, sel.listingPrice],
  item: [],
  home: [sel.loggedIn],
};
