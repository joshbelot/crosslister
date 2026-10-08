# 06 — Marketplace Adapters (M8, M19, M21–M26)

> **Calibration warning.** URLs, field labels, option texts, category trees and limits below are the best available knowledge as of 2026-10 and were **not verified against the live sites** (see `../MARKETPLACE_RESEARCH.md`). Everything marked *(verify)* is expected to need calibration on the user's Mac (05 §9). The framework is designed so that any wrong selector degrades to "needs your attention" instead of failing.

Folder per adapter: `index.ts` (adapter object + recipes), `mapping.ts` (pure mapping functions + tables, unit-tested), `selectors.ts` (`LocatorSpec`s + `selectorGroups`). eBay has `auth.ts`, `trading.ts`, `rest.ts`, `xml.ts` instead of `selectors.ts`.

Shared helpers in `marketplaces/common.ts` (besides 05 §6.5/§7): `buildCategoryPath`, `resolveCategoryPath(db, adapter, eff, mlData)`, `mapCondition(eff, table, override)`, `mapColors(colors, table, max)`, `standardCopyFields(eff, mapping)`, `detectByUrlOrLink(page, pathRegex, signal, opts?: { successText?: RegExp })`, `hostOk(url, hosts)`, `lastPathSegment(url)`.

`detectByUrlOrLink`: resolve when (a) `page.url()` pathname matches `pathRegex`, or (b) `successText` is visible **and** an `<a href>` on the page matches `pathRegex` (take the first). Poll every 1.5 s; abort on signal. Returns `{ remoteId: match[1], url: absolute canonical URL }`.

Common `dataSchema` fields for every browser adapter (merge into each adapter's own schema):

```ts
const browserCommonData = {
  categoryPath: z.string().max(300).optional(),        // "A > B > C" per-listing override
  conditionOverride: z.string().max(60).optional(),    // exact marketplace condition label
};
```

and matching `dataFields`: `{ key: 'categoryPath', label: 'Category on <N>', type: 'path', help: 'Example: Men > Shoes > Sneakers. Leave empty to use the automatic mapping.' }`, `{ key: 'conditionOverride', label: 'Condition on <N>', type: 'select', options: <the adapter's condition labels> }`.

---

## 1. Manual adapter (`marketplaces/manual/index.ts`) — M8

```ts
export function manualAdapter(id: MarketplaceId, name: string, urls: { home: string; sell: string }, capOverrides?: Partial<MarketplaceCapabilities>): MarketplaceAdapter;
```

- `kind: 'manual'`. Capabilities: `{ publish: 'manual', update: 'manual', deactivate: 'manual', statusCheck: 'none', import: 'url', autoSubmitAllowed: false, maxPhotos: 24, titleMaxLength: 100, descriptionMaxLength: 5000, minPriceCents: 100, maxPriceCents: null, requires: ['title', 'price'] }` merged with `capOverrides`.
- Registry overrides: `etsy: { titleMaxLength: 140, descriptionMaxLength: 10000 }`, `vinted: { titleMaxLength: 100, descriptionMaxLength: 2000 }` *(verify)*.
- `photoSpec`: `{ maxPhotos: 24, maxLongEdge: 2048, quality: 88 }`. `dataSchema: z.object({})`, `dataFields: []`.
- `validate`: Etsy only — warning `Etsy only allows handmade items, vintage items (20+ years old) and craft supplies.`
- `parseListingUrl(url)`: valid `http(s)` URL whose host matches the home host (skip when home is `about:blank`) → `{ remoteId: lastPathSegment(url), url }`.
- `listingUrl(remoteId)` → `urls.home`.
- `connect` → `{ status: 'connected', accountName: null, message: 'Manual marketplace — nothing to connect.' }`.
- `publish(ctx, l)` → `requestUser({ reason: 'manual_listing', title: 'List on <N>', instructions: 'Create the listing on <N> using the values below (click a value to copy it). Drag the photos from the photos folder. Then paste the listing\'s address below.', copyFields: standardCopyFields(l, describeMapping(l)), photoFolder: processedDir(...), link: { label: 'Open <N>', url: urls.sell }, allowUrlInput: true, primaryAction: 'I listed it' })`. Returns `{ remoteId, url, verified: Boolean(url) }` from `parseListingUrl` (or `{ null, url, false }` if unparsable).
- `update` → `requestUser({ reason: 'manual_listing', title: 'Update on <N>', instructions: 'Update the title, description and price on <N>.', copyFields: Title/Description/Price, link: { label: 'Open listing', url: ml.url ?? urls.home }, primaryAction: 'Done' })`.
- `deactivate` → `requestUser({ reason: 'manual_delist', title: 'Remove from <N>', instructions: 'Delete the listing or mark it as sold on <N>, then click “It\'s removed”.', link: { label: 'Open listing', url: ml.url ?? urls.home }, primaryAction: "It's removed" })`.
- `describeMapping` → Condition (canonical label), Category (`categoryPathLabel`).

---

## 2. Mercari (`marketplaces/mercari/`) — M19

### 2.1 Basics

| Item | Value |
|---|---|
| kind | `browser` |
| urls | home `https://www.mercari.com/`, sell `https://www.mercari.com/sell/`, login `https://www.mercari.com/login/` *(verify)* |
| listing URL | `https://www.mercari.com/us/item/<id>/`, regex `/\/us\/item\/(m\d{6,})/`, hosts `['mercari.com']` |
| edit URL | `https://www.mercari.com/sell/edit/<id>/` *(verify)* |
| capabilities | publish `assisted`, update `assisted`, deactivate `assisted`, statusCheck `browser`, import `browser`, autoSubmitAllowed `true`, maxPhotos `12`, titleMaxLength `80`, descriptionMaxLength `1000`, minPriceCents `100`, maxPriceCents `200000`, requires `['title','description','price','condition','category','shippingWeight']` *(verify limits)* |
| photoSpec | `{ maxPhotos: 12, maxLongEdge: 2048, quality: 88 }` |
| auth | loginUrlPattern `/\/(login|signin|signup)/i`; loggedInIndicator: `{ role: 'link', name: /my page|profile|account/i }`, `{ role: 'button', name: /account|profile/i }`, `{ css: '[data-testid*="Avatar" i]' }`; challengeIndicator `{ text: /verify|verification code|confirm it's you/i }` |

### 2.2 Data

```ts
dataSchema = z.object({ ...browserCommonData, shippingPayer: z.enum(['buyer', 'seller']).optional() });
```
`dataFields`: common fields + `{ key: 'shippingPayer', label: 'Who pays shipping on Mercari', type: 'select', options: [buyer, seller] }` (default from `shipping.whoPays`).

### 2.3 Mapping (`mapping.ts`)

```ts
export const MERCARI_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['New'], new_without_tags: ['Like new'], like_new: ['Like new'],
  good: ['Good'], fair: ['Fair'], poor: ['Poor'],
};
export const MERCARI_COLORS: Record<ColorId, string[]> = {
  black: ['Black'], white: ['White'], gray: ['Gray'], brown: ['Brown'], tan: ['Beige', 'Brown'], beige: ['Beige'],
  cream: ['Beige', 'White'], red: ['Red'], pink: ['Pink'], orange: ['Orange'], yellow: ['Yellow'], green: ['Green'],
  blue: ['Blue'], navy: ['Blue'], purple: ['Purple'], gold: ['Gold'], silver: ['Silver'], multicolor: [],
};
export const MERCARI_CATEGORY_SYNONYMS: Record<string, string[]> = {
  'women.tops': ['Tops & blouses', 'Tops'], 'men.tops': ['Tops', 'Shirts'],
  'women.outerwear': ['Coats & jackets', 'Jackets & coats'], 'men.outerwear': ['Coats & jackets', 'Jackets & coats'],
  'women.tops.t_shirts': ['T-shirts', 'Tees'], 'men.tops.t_shirts': ['T-shirts', 'Tees'],
  'men.tops.shirts': ['Button-front', 'Casual button-down shirts', 'Button down'],
  'women.tops.sweaters': ['Sweaters'], 'men.tops.sweaters': ['Sweaters'],
  'women.tops.sweatshirts_hoodies': ['Sweatshirts & hoodies', 'Hoodies'], 'men.tops.sweatshirts_hoodies': ['Sweatshirts & hoodies', 'Hoodies'],
  'women.shoes.sneakers': ['Sneakers', 'Athletic'], 'men.shoes.sneakers': ['Sneakers', 'Athletic'],
  'men.shoes.dress_shoes': ['Oxfords', 'Dress shoes', 'Loafers & slip-ons'],
  'women.bags': ['Bags', 'Handbags'], 'women.bags.handbags': ['Shoulder bags', 'Totes & shoppers', 'Handbags'],
  'women.jewelry': ['Jewelry'], 'men.jewelry': ['Jewelry'],
  'electronics.video_games': ['Video games & consoles'], 'electronics.phones': ['Cell phones & accessories', 'Cell phones & smartphones'],
  'collectibles': ['Vintage & collectibles', 'Toys & collectibles'], 'collectibles.trading_cards': ['Trading cards'],
  'kids': ['Kids'], 'home': ['Home'], 'other': ['Other'],
};
export const MERCARI_CATEGORY_SKIP = ['women.bottoms', 'men.bottoms']; // Mercari lists Jeans/Pants/Shorts directly under department (verify)
export const MERCARI_CATEGORY_OVERRIDES: Record<string, Array<string | string[]>> = {
  'other.other': ['Other', 'Other'],
};
export function mercariShippingWeight(weightOz: number): { lb: number; oz: number }; // 20 → { lb: 1, oz: 4 }; rounds oz up to integer
```

`describeMapping`: Condition → `conditionOverride ?? MERCARI_CONDITIONS[c][0]`; Category → resolved path joined with ` › `; Colors → mapped labels; Shipping weight → `1 lb 4 oz`.

### 2.4 Selectors (`selectors.ts`) *(verify all)*

```ts
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
  // edit/deactivate
  deactivateButton: { what: 'Deactivate', candidates: [{ role: 'button', name: /^deactivate/i }, { text: /^deactivate/i }] },
  deactivateConfirm: { what: 'Confirm deactivate', candidates: [{ role: 'button', name: /^(deactivate|yes|confirm)/i }] }, // resolve inside page.getByRole('dialog').last()
};
export const selectorGroups = { sell: [/* every sell spec */], edit: [/* deactivate specs */], item: [], home: [/* login indicator */] };
```

### 2.5 Publish recipe (order matters)

| key | label | required | action |
|---|---|---|---|
| photos | Uploading N photos | yes | `uploadFiles(sel.photoInput, l.photoPaths, { previews: sel.photoPreviews })` |
| title | Filling title | no | `fillText(sel.title, l.title)` |
| description | Filling description | no | `fillText(sel.description, l.description)` |
| category | Selecting category | no | `choosePath(page, sel.categoryTrigger, path)`; no path → throw (becomes missing) |
| brand | Selecting brand | no | skip silently if `l.brand` empty; `typeahead(sel.brand, l.brand, { allowCustom: false })` |
| condition | Selecting condition | no | `chooseRadio(sel.conditionGroup, mapped)` |
| size | Selecting size | no | skip silently if `sizeType === 'none'` or the size control doesn't exist (`exists(sel.sizeTrigger, 2000)`); `chooseOption(sel.sizeTrigger, sizeSynonyms(l.size))` |
| color | Selecting color | no | skip silently if no colors or no control; `chooseOption(sel.colorTrigger, mapped[0])` (Mercari: one color) |
| shipping | Setting shipping weight | no | `{lb, oz} = mercariShippingWeight(weightOz)`; `fillText(weightLb, String(lb))`, `fillText(weightOz, String(oz))`; then `chooseRadio(shippingPayerGroup, payer === 'buyer' ? ['Buyer', 'The buyer'] : ['I\'ll pay', 'Seller', 'Me'])` |
| price | Filling price | no | `fillText(sel.price, (l.priceCents/100).toFixed(2))`; if `smartPricingToggle` exists and is on, turn it off |

`submitButton: sel.submit`, `submitLabel: 'List'`, `detectPublished: detectByUrlOrLink(page, /\/us\/item\/(m\d{6,})/, signal, { successText: /listed|is live|congrat/i })`.

### 2.6 Deactivate recipe

`editUrl = https://www.mercari.com/sell/edit/<remoteId>/` (fallback `ml.url`); steps: none; `confirmButton`: click `sel.deactivateButton` first (as a step), then `sel.deactivateConfirm`; `confirmLabel: 'Deactivate'`; `detectDone`: visible text `/deactivated|inactive/i` or the deactivate button disappears.

### 2.7 Update recipe (M26)

`editUrl` as above; re-fill `title`, `description`, `price`; submit button `{ role: 'button', name: /^(update|save)/i }`, label `Update`; `detectSaved`: pathname no longer starts with `/sell/edit/`.

### 2.8 Validation extras

- Warning when `l.colors.includes('multicolor')`: `Mercari has no "Multicolor" option — color will be left empty.`

---

## 3. Poshmark (`marketplaces/poshmark/`) — M21

### 3.1 Basics

| Item | Value |
|---|---|
| urls | home `https://poshmark.com/`, sell `https://poshmark.com/create-listing`, login `https://poshmark.com/login` *(verify)* |
| listing URL | `https://poshmark.com/listing/<slug>-<id>`, regex `/\/listing\/(?:[^/]*-)?([a-f0-9]{24})\/?$/`, hosts `['poshmark.com']` |
| edit URL | `https://poshmark.com/edit-listing/<id>` *(verify)* |
| capabilities | publish `assisted`, update `assisted`, deactivate `assisted`, statusCheck `browser`, import `browser`, autoSubmitAllowed `true`, maxPhotos `16`, titleMaxLength `80`, descriptionMaxLength `1500`, minPriceCents `300`, maxPriceCents `null`, requires `['title','description','price','category','size','msrp']` |
| photoSpec | `{ maxPhotos: 16, maxLongEdge: 2048, quality: 88 }` |
| auth | loginUrlPattern `/\/login|\/signup/i`; loggedInIndicator `{ role: 'link', name: /my closet/i }`, `{ css: '[data-et-name="profile"]' }`, `{ css: 'img.user-image' }` |
| account name | from the "My Closet" link href `/closet/<username>` |

Poshmark terms reportedly prohibit automated access (research §2.2). Show once (first Poshmark cross-list) a confirm dialog in the UI: "Poshmark's terms restrict automated tools. The app will fill the form and you'll click List yourself. Continue?" with "Don't show again" (KV `poshmark_notice_ack`).

### 3.2 Data

```ts
dataSchema = z.object({ ...browserCommonData, styleTags: z.array(z.string().max(30)).max(3).default([]) });
```
`dataFields`: common + `{ key: 'styleTags', label: 'Style tags', type: 'tags', maxItems: 3 }`. If `styleTags` is empty, use the first 3 of `l.tags`.

### 3.3 Mapping

```ts
export const POSHMARK_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['New With Tags', 'NWT'], new_without_tags: ['New Without Tags', 'Like New'], like_new: ['Like New'],
  good: ['Good'], fair: ['Fair'], poor: ['Poor', 'Fair'],
};
export const POSHMARK_COLORS: Record<ColorId, string[]> = {
  black: ['Black'], white: ['White'], gray: ['Gray'], brown: ['Brown'], tan: ['Tan'], beige: ['Tan', 'Cream'], cream: ['Cream'],
  red: ['Red'], pink: ['Pink'], orange: ['Orange'], yellow: ['Yellow'], green: ['Green'], blue: ['Blue'], navy: ['Blue'],
  purple: ['Purple'], gold: ['Gold'], silver: ['Silver'], multicolor: [],
};
export const POSHMARK_CATEGORY_SKIP = ['women.bottoms', 'men.bottoms', 'women.tops', 'men.tops'];
export const POSHMARK_CATEGORY_OVERRIDES: Record<string, Array<string | string[]>> = {
  'women.tops.t_shirts': ['Women', 'Tops', ['Tees - Short Sleeve', 'Tees']],
  'women.tops.blouses': ['Women', 'Tops', ['Blouses', 'Button Down Shirts']],
  'women.tops.tank_tops': ['Women', 'Tops', ['Tank Tops', 'Camisoles']],
  'women.tops.sweaters': ['Women', 'Sweaters'],
  'women.tops.sweatshirts_hoodies': ['Women', 'Tops', ['Sweatshirts & Hoodies']],
  'women.bottoms.jeans': ['Women', 'Jeans'],
  'women.bottoms.pants': ['Women', ['Pants & Jumpsuits', 'Pants']],
  'women.bottoms.leggings': ['Women', ['Pants & Jumpsuits', 'Pants'], 'Leggings'],
  'women.outerwear': ['Women', 'Jackets & Coats'],
  'women.activewear': ['Women', 'Tops', 'Athletic'],   // verify
  'women.swimwear': ['Women', 'Swim'],
  'women.bags': ['Women', 'Bags'],
  'women.accessories': ['Women', 'Accessories'],
  'men.tops.t_shirts': ['Men', 'Shirts', ['Tees - Short Sleeve', 'Tees']],
  'men.tops.shirts': ['Men', 'Shirts', ['Casual Button Down Shirts', 'Button Down']],
  'men.tops.polos': ['Men', 'Shirts', 'Polos'],
  'men.tops.sweaters': ['Men', 'Sweaters'],
  'men.tops.sweatshirts_hoodies': ['Men', 'Shirts', ['Sweatshirts & Hoodies']],
  'men.bottoms.jeans': ['Men', 'Jeans'],
  'men.bottoms.pants': ['Men', 'Pants'],
  'men.bottoms.shorts': ['Men', 'Shorts'],
  'men.outerwear': ['Men', 'Jackets & Coats'],
  'men.suits_blazers': ['Men', 'Suits & Blazers'],
  'men.swimwear': ['Men', 'Swim'],
  'men.bags': ['Men', 'Bags'],
  'men.accessories': ['Men', 'Accessories'],
  'kids.girls_clothing': ['Kids', ['Girls', 'Dresses']], 'kids.boys_clothing': ['Kids', ['Boys', 'Shirts & Tops']],
  'kids.shoes': ['Kids', 'Shoes'], 'kids.toys': ['Kids', 'Toys'],
  'home': ['Home'], 'electronics': ['Electronics'],
};
export const POSHMARK_CATEGORY_SYNONYMS: Record<string, string[]> = {
  'women.shoes.flats': ['Flats & Loafers'], 'women.shoes.boots': ['Ankle Boots & Booties', 'Boots'],
  'men.shoes.dress_shoes': ['Loafers & Slip-Ons', 'Oxfords & Derbys'], 'women.outerwear.jackets': ['Jackets'],
};
```

Unsupported departments (`collectibles`, `other`) → validation error `Poshmark doesn't have a category for this item.`

### 3.4 Selectors *(verify)*

| key | candidates (in order) |
|---|---|
| photoInput | `css input[type="file"][accept*="image"]`, `css input[type="file"]` (attached) |
| photoPreviews | `css .listing-editor__image img`, `css img[src^="blob:"]`, `css [data-test*="image-tile" i] img` |
| title | `placeholder /what are you selling/i`, `label /title/i`, `css input[data-vv-name="title"]` |
| description | `placeholder /describe it/i`, `label /description/i`, `css textarea[data-vv-name="description"]` |
| categoryTrigger | `text /^select category$/i`, `role button name /category/i`, `css [data-et-name="category"]` |
| sizeTrigger | `text /^select size$/i`, `role button name /size/i` |
| conditionTrigger | `role button name /condition/i`, `label /condition/i` |
| brand | `placeholder /enter the brand|brand/i`, `label /brand/i` |
| colorTrigger | `role button name /color/i`, `text /^color$/i` |
| colorDone | `role button name /^done$/i` |
| styleTagInput | `placeholder /style tag/i`, `label /style tags?/i` |
| originalPrice | `label /original price/i`, `placeholder /original price/i`, `css input[data-vv-name="originalPrice"]` |
| listingPrice | `label /listing price/i`, `placeholder /listing price/i`, `css input[data-vv-name="listingPrice"]` |
| next/submit | `role button name /^next$/i` then `role button name /^list( this item)?$/i` |
| edit: availabilityTrigger | `label /availability/i`, `role button name /availability|for sale/i` |
| edit: update | `role button name /^update$/i` |
| edit: delete | `role button name /^delete listing$/i`, `text /^delete listing$/i` |
| edit: deleteConfirm | `role button name /^(yes|delete)$/i` |

### 3.5 Publish recipe

photos (required) → title → description → category (`choosePath(categoryTrigger, path)`; Poshmark's menu shows department tabs then categories then subcategories) → size (`chooseOption(sizeTrigger, sizeSynonyms(size))`) → condition (`chooseOption(conditionTrigger, mapped)`) → brand (`typeahead(brand, l.brand, { allowCustom: true })`, skip if empty) → colors (`chooseMany(colorTrigger, mapped.slice(0,2), { doneButton: colorDone })`, skip if none) → style tags (for each: `fillText(styleTagInput, tag)` + `Enter`) → original price (`(msrpCents/100).toFixed(0)`) → listing price (`(priceCents/100).toFixed(0)`; Poshmark uses whole dollars — validation warning if price has cents: `Poshmark uses whole-dollar prices; ${formatCents(p)} will be listed as ${formatCentsShort(round)}.`).

Submit: Poshmark has **Next** → review page → **List**. Recipe: add a final optional field `next` ("Opening review page") that clicks the Next button; `submitButton` = List button, `submitLabel: 'List'`. `detectPublished: detectByUrlOrLink(page, /\/listing\/(?:[^/]*-)?([a-f0-9]{24})/, signal, { successText: /listed|share/i })`.

### 3.6 Deactivate recipe

`editUrl = https://poshmark.com/edit-listing/<remoteId>`; steps: `chooseOption(availabilityTrigger, ['Not For Sale'])` (reversible; preferred); `confirmButton = update`, `confirmLabel: 'Update'`; `detectDone`: pathname leaves `/edit-listing/`. If availability is not found, fall back to steps `click(delete)` + `confirmButton = deleteConfirm`, `confirmLabel: 'Yes'`.

### 3.7 Update recipe

Same edit URL; re-fill title, description, listing price; submit `update`; `detectSaved`: pathname leaves `/edit-listing/`.

---

## 4. Depop (`marketplaces/depop/`) — M22

### 4.1 Basics

| Item | Value |
|---|---|
| urls | home `https://www.depop.com/`, sell `https://www.depop.com/products/create/`, login `https://www.depop.com/login/` *(verify)* |
| listing URL | `https://www.depop.com/products/<slug>/`, regex `/\/products\/(?!create\/|edit\/)([a-z0-9][a-z0-9-]+)\/?$/i`, hosts `['depop.com']` |
| edit URL | `https://www.depop.com/products/edit/<slug>/` *(verify)* |
| capabilities | publish `assisted`, update `assisted`, deactivate `assisted`, statusCheck `browser`, import `browser`, autoSubmitAllowed `true`, maxPhotos `8`, **titleMaxLength `null`**, descriptionMaxLength `1000`, minPriceCents `100`, maxPriceCents `null`, requires `['description','price','condition','category','size']` *(verify)* |
| photoSpec | `{ maxPhotos: 8, maxLongEdge: 1600, quality: 88 }` |
| auth | loginUrlPattern `/\/login|\/signup/i`; loggedInIndicator `{ role: 'link', name: /profile|my shop/i }`, `{ css: '[data-testid="navigation__profile"]' }` |

### 4.2 Data and description

```ts
dataSchema = z.object({ ...browserCommonData, hashtags: z.array(z.string().regex(/^[a-z0-9]+$/i).max(30)).max(5).default([]) });
```
`finalizeDescription(l)`: `[l.title, l.description, hashtagLine].filter(Boolean).join('\n\n')` where `hashtagLine` = `#` + each of (`data.hashtags` if non-empty else first 5 of `l.tags` with non-alphanumerics removed, lower-cased), joined by spaces. (Depop has no title field; the first line acts as the title.)

### 4.3 Mapping

```ts
export const DEPOP_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['Brand new'], new_without_tags: ['Brand new', 'Like new'], like_new: ['Like new'],
  good: ['Used - Excellent', 'Excellent'], fair: ['Used - Good', 'Good'], poor: ['Used - Fair', 'Fair'],
};
export const DEPOP_COLORS: Record<ColorId, string[]> = {
  black: ['Black'], white: ['White'], gray: ['Grey', 'Gray'], brown: ['Brown'], tan: ['Tan'], beige: ['Cream', 'Tan'], cream: ['Cream'],
  red: ['Red'], pink: ['Pink'], orange: ['Orange'], yellow: ['Yellow'], green: ['Green'], blue: ['Blue'], navy: ['Navy'],
  purple: ['Purple'], gold: ['Gold'], silver: ['Silver'], multicolor: ['Multi'],
};
export const DEPOP_CATEGORY_SYNONYMS: Record<string, string[]> = {
  women: ['Womenswear', 'Women'], men: ['Menswear', 'Men'], kids: ['Kidswear', 'Kids'],
  'women.shoes': ['Footwear', 'Shoes'], 'men.shoes': ['Footwear', 'Shoes'],
  'women.shoes.sneakers': ['Trainers', 'Sneakers'], 'men.shoes.sneakers': ['Trainers', 'Sneakers'],
  'women.tops.t_shirts': ['T-shirts'], 'men.tops.t_shirts': ['T-shirts'],
  'women.tops.sweatshirts_hoodies': ['Hoodies', 'Sweatshirts'], 'men.tops.sweatshirts_hoodies': ['Hoodies', 'Sweatshirts'],
  'women.outerwear': ['Coats & jackets', 'Outerwear'], 'men.outerwear': ['Coats & jackets', 'Outerwear'],
  'women.accessories': ['Accessories'], 'men.accessories': ['Accessories'],
  home: ['Home', 'Everything else'], electronics: ['Electronics', 'Everything else'], collectibles: ['Everything else'], other: ['Everything else'],
};
export const DEPOP_CATEGORY_SKIP = [];
export function depopParcelSize(weightOz: number | null): string[] | null; // ≤4 ['Extra small','XS'], ≤8 ['Small'], ≤16 ['Medium'], ≤48 ['Large'], else ['Extra large','XL']; null weight → null (verify tiers)
```

### 4.4 Selectors *(verify)*

photoInput `css input[type="file"]` (attached) · photoPreviews `css [data-testid*="photo" i] img`, `css img[src^="blob:"]` · description `label /description/i`, `css textarea[name="description"]` · categoryTrigger `label /category/i`, `role combobox name /category/i` · brand `label /brand/i`, `role combobox name /brand/i` · conditionTrigger `label /condition/i`, `role combobox name /condition/i` · sizeTrigger `label /size/i`, `role combobox name /size/i` · colorTrigger `label /colou?r/i` · price `label /^price/i`, `css input[name="priceAmount"]` · parcelTrigger `label /parcel size|package size/i`, `role radiogroup name /parcel|package/i` · submit `role button name /^(post|list|publish)( item)?$/i` · edit: `role button name /^delete( listing)?$/i`, confirm `role button name /^(delete|yes)/i`.

### 4.5 Publish recipe

photos (required) → description (`fillText(description, l.description)` — already finalized) → category (`choosePath`; Depop category is a combobox; if the trigger is a combobox with a search input, `typeahead` the leaf label instead — implement: try `choosePath`, on failure try `typeahead(categoryTrigger, path.at(-1))`) → brand (`typeahead`, `allowCustom: false`, skip if empty) → condition (`chooseOption`) → size (skip if `sizeType === 'none'` or control missing) → colors (`chooseMany`, max 2) → price (`(priceCents/100).toFixed(2)`) → shipping (`depopParcelSize` → `chooseRadio(parcelTrigger, tiers)`; skip and mark missing if weight null).

`submitLabel: 'Post'`; `detectPublished: detectByUrlOrLink(page, <listing regex>, signal, { successText: /listed|posted|live/i })`.

### 4.6 Deactivate / update

Deactivate: open `ml.url` (or edit URL) → step click delete → `confirmButton` delete-confirm, `confirmLabel: 'Delete'` → `detectDone`: pathname leaves the product page or text `/deleted/i`. Update: edit URL, re-fill description (finalized) and price; submit `role button name /^(save|update)/i`; `detectSaved`: pathname leaves `/products/edit/`.

---

## 5. eBay (`marketplaces/ebay/`) — M23 (official API)

### 5.1 Basics

| Item | Value |
|---|---|
| kind | `api` |
| urls | home `https://www.ebay.com/`, sell `https://www.ebay.com/sl/sell` (sandbox: `https://sandbox.ebay.com/`) |
| listing URL | `https://www.ebay.com/itm/<ItemID>`, regex `/\/itm\/(?:[^/]+\/)?(\d{9,15})/`, hosts `['ebay.com']` |
| capabilities | publish `auto`, update `auto`, deactivate `auto`, statusCheck `api`, import `api`, autoSubmitAllowed `true`, maxPhotos `24`, titleMaxLength `80`, descriptionMaxLength `500000`, minPriceCents `99`, maxPriceCents `null`, requires `['title','price','condition','category']` |
| photoSpec | `{ maxPhotos: 24, maxLongEdge: 1600, quality: 90 }` |
| env | `EBAY_ENV`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME` (missing → connection `not_configured`) |

Host table:

| | production | sandbox |
|---|---|---|
| authorize | `https://auth.ebay.com/oauth2/authorize` | `https://auth.sandbox.ebay.com/oauth2/authorize` |
| REST + token | `https://api.ebay.com` | `https://api.sandbox.ebay.com` |
| Trading | `https://api.ebay.com/ws/api.dll` | `https://api.sandbox.ebay.com/ws/api.dll` |
| item page | `https://www.ebay.com/itm/<id>` | `https://sandbox.ebay.com/itm/<id>` |

### 5.2 Data

```ts
dataSchema = z.object({
  categoryId: z.string().regex(/^\d+$/).optional(),
  categoryName: z.string().optional(),               // full path label for display
  categoryAuto: z.boolean().default(true),           // true = picked automatically; false = user chose
  requiredAspects: z.array(z.string()).default([]),  // snapshot from getItemAspectsForCategory
  aspects: z.record(z.string(), z.array(z.string())).default({}), // user-entered item specifics
  conditionId: z.number().int().optional(),          // user override
  bestOffer: z.boolean().default(false),
});
```

`dataFields`: `{ key: 'categoryId', label: 'eBay category', type: 'ebay_category' }`, `{ key: 'aspects', label: 'Item specifics', type: 'ebay_aspects' }`, `{ key: 'conditionId', label: 'eBay condition', type: 'select' /* options loaded from /conditions */ }`, `{ key: 'bestOffer', label: 'Accept offers (Best Offer)', type: 'boolean' }`.

### 5.3 Auth (`auth.ts`)

```ts
export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
];
export function isConfigured(): boolean;                       // all four env values present
export function buildAuthorizeUrl(state: string): string;      // ?client_id&redirect_uri=<RuName>&response_type=code&scope=<space-joined, URL-encoded>&state
export async function exchangeCode(code: string): Promise<void>; // POST /identity/v1/oauth2/token  grant_type=authorization_code&code&redirect_uri=<RuName>; Basic auth base64(clientId:clientSecret); stores refresh token (secret ebay_refresh_token) and access token (secret ebay_access_token = JSON {token, expiresAt})
export async function getUserAccessToken(): Promise<string>;   // cached access token if > 5 min left, else refresh: grant_type=refresh_token&refresh_token&scope=<scopes>; no refresh token → AdapterError('NOT_CONNECTED')
export async function getAppToken(): Promise<string>;          // client_credentials, scope api_scope; cached in memory until 5 min before expiry
export async function disconnect(): Promise<void>;             // delete both secrets
```

Token request: `Content-Type: application/x-www-form-urlencoded`, `Authorization: Basic …`. Non-2xx → `AdapterError('API_ERROR', …, body.error_description)`. `invalid_grant` on refresh → delete secrets and throw `NOT_CONNECTED` ("eBay sign-in expired. Reconnect eBay in Settings.").

### 5.4 Connect flow

`connect(ctx)`:
1. `!isConfigured()` → return `{ status: 'not_configured', accountName: null, message: 'Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RUNAME to .env (see docs/SETUP.md).' }`.
2. `state = nanoid(24)`; store in job `input.state`; `url = buildAuthorizeUrl(state)`; on macOS `execFile('open', [url])`.
3. `const { url: pasted } = await ctx.requestUser({ reason: 'login', title: 'Connect eBay', instructions: 'Sign in to eBay in the tab that opened and click “Agree”. If the tab shows an error page afterwards, copy its full address from the address bar and paste it below.', link: { label: 'Open eBay sign-in', url }, allowUrlInput: true, primaryAction: 'Done' })`.
4. Extract `code` from the pasted/callback URL (`new URL(u).searchParams.get('code')`); verify `state` if present; missing code → `AdapterError('API_ERROR', …, 'No authorization code found in that address.')`.
5. `await exchangeCode(code)`; Trading `GetUser` → `User.UserID` as account name; save KV `ebay_auth_meta`.
6. Return `{ status: 'connected', accountName, message: null }`.

Callback route (`registerRoutes`): `GET /api/marketplaces/ebay/oauth/callback?code&state` → find the job of type `connect`, marketplace `ebay`, state `NEEDS_USER` with `input.state === state`; resume it with `{ url: <full request URL> }`; respond with a small HTML page: "eBay is connected. You can close this tab." (or "No pending eBay connection." if none).

### 5.5 Trading API client (`trading.ts`, `xml.ts`)

```ts
export async function tradingCall<T = any>(callName: string, innerXml: string, opts?: { formData?: FormData }): Promise<T>;
```
- POST to the Trading URL. Headers: `X-EBAY-API-CALL-NAME: <callName>`, `X-EBAY-API-SITEID: 0`, `X-EBAY-API-COMPATIBILITY-LEVEL: 1349`, `X-EBAY-API-IAF-TOKEN: <user access token>`, `Content-Type: text/xml` (omit Content-Type when sending `formData`).
- Body: `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${innerXml}<ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel></${callName}Request>`.
- Parse with `fast-xml-parser` (`ignoreAttributes: false`, `attributeNamePrefix: '@_'`, `isArray` for `Errors`, `PictureURL`, `NameValueList`, `Value`, `Item`, `Fee`). Return `parsed[callName + 'Response']`.
- `Ack` `Failure` (or `PartialFailure` with any `SeverityCode=Error`) → `AdapterError('API_ERROR', 'eBay returned an error: …', LongMessage(s) joined by ' ')`. Log warnings at `warn`.
- `xml.ts`: `escapeXml(s)`, `cdata(s)` (split `]]>` safely), `descriptionToHtml(text)` = escape HTML, then paragraphs on blank lines → `<p>…</p>`, single newlines → `<br>`.

Calls used: `GetUser`, `UploadSiteHostedPictures`, `VerifyAddFixedPriceItem`, `AddFixedPriceItem`, `ReviseFixedPriceItem`, `EndFixedPriceItem`, `GetItem`, `GetMyeBaySelling`.

**UploadSiteHostedPictures** (one call per photo): `FormData` with part `XML Payload` = full request XML containing `<PictureName>${sku}-${nn}</PictureName><PictureSet>Supersize</PictureSet>`, and part `image` = `new Blob([await fs.readFile(path)], { type: 'image/jpeg' })` with filename `${nn}.jpg`. Result: `SiteHostedPictureDetails.FullURL`.

**Item XML** (`buildItemXml(l, data, settings, pictureUrls, conditionId, aspects)`):

```xml
<Item>
  <Title>{title}</Title>
  <Description>{cdata(descriptionToHtml(description))}</Description>
  <PrimaryCategory><CategoryID>{data.categoryId}</CategoryID></PrimaryCategory>
  <StartPrice currencyID="USD">{(priceCents/100).toFixed(2)}</StartPrice>
  <CategoryMappingAllowed>true</CategoryMappingAllowed>
  <ConditionID>{conditionId}</ConditionID>
  <ConditionDescription>{conditionNotes ≤ 1000 chars; only when conditionId ≥ 2000}</ConditionDescription>
  <Country>US</Country><Currency>USD</Currency>
  <DispatchTimeMax>{settings.ebay.dispatchTimeDays}</DispatchTimeMax>
  <ListingDuration>GTC</ListingDuration>
  <ListingType>FixedPriceItem</ListingType>
  <PostalCode>{settings.ebay.postalCode}</PostalCode>
  <Quantity>{quantity}</Quantity>
  <SKU>{sku}</SKU>
  <PictureDetails>{pictureUrls.map(u => <PictureURL>u</PictureURL>)}</PictureDetails>
  <ItemSpecifics>{for each [name, values]: <NameValueList><Name>name</Name>{values.map(v => <Value>v</Value>)}</NameValueList>}</ItemSpecifics>
  <SellerProfiles>
    <SellerShippingProfile><ShippingProfileID>{fulfillmentPolicyId}</ShippingProfileID></SellerShippingProfile>
    <SellerReturnProfile><ReturnProfileID>{returnPolicyId}</ReturnProfileID></SellerReturnProfile>
    <SellerPaymentProfile><PaymentProfileID>{paymentPolicyId}</PaymentProfileID></SellerPaymentProfile>
  </SellerProfiles>
  <!-- only when shipping.weightOz is set -->
  <ShippingPackageDetails>
    <WeightMajor unit="lbs">{floor(oz/16)}</WeightMajor><WeightMinor unit="oz">{ceil(oz%16)}</WeightMinor>
    <!-- only when all three dimensions set -->
    <PackageDepth unit="in">{heightIn}</PackageDepth><PackageLength unit="in">{lengthIn}</PackageLength><PackageWidth unit="in">{widthIn}</PackageWidth>
  </ShippingPackageDetails>
  <!-- only when data.bestOffer -->
  <BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>
</Item>
```
All text values go through `escapeXml`.

### 5.6 REST client (`rest.ts`)

All GET with `Authorization: Bearer <token>`, `Accept: application/json`. Cache successful taxonomy/metadata responses in memory for 24 h keyed by URL.

```ts
export async function suggestCategories(q: string): Promise<Array<{ categoryId: string; name: string; path: string }>>;
// GET /commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=<q>  (app token)
// path = ancestors (categoryTreeNodeAncestors reversed by level) + name joined with ' > '
export async function getAspects(categoryId: string): Promise<Array<{ name: string; required: boolean; mode: 'FREE_TEXT' | 'SELECTION_ONLY'; multi: boolean; values: string[] }>>;
// GET /commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=<id>  (app token); values capped at 300
export async function getConditions(categoryId: string): Promise<Array<{ conditionId: number; label: string }>>;
// GET /sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=categoryIds:%7B<id>%7D  (app token)
export async function getPolicies(): Promise<{ fulfillment: Array<{ id: string; name: string }>; payment: Array<{ id: string; name: string }>; return: Array<{ id: string; name: string }> }>;
// GET /sell/account/v1/{fulfillment_policy|payment_policy|return_policy}?marketplace_id=EBAY_US  (user token)
```

### 5.7 Mapping (`mapping.ts`)

```ts
export const EBAY_CONDITION_PREFERENCE: Record<Condition, number[]> = {
  new_with_tags: [1000],
  new_without_tags: [1500, 1000],
  like_new: [2750, 2990, 4000, 3000],
  good: [3000, 5000, 4000],
  fair: [3010, 6000, 5000, 3000],
  poor: [7000, 3010, 6000, 3000],
};
export function pickConditionId(c: Condition, allowed: number[]): number | null; // first preferred id contained in allowed; else null
export function categoryQuery(l: EffectiveListing): string;
// men/women: `${'Men'|'Women'}'s ${leafLabel}` ; kids: leafLabel ; else leafLabel ; append model? no. Example "Men's Sneakers".
export function autoAspects(l: EffectiveListing, aspects: AspectDef[]): Record<string, string[]>;
```

`autoAspects` fills (only aspects that exist for the category; for `SELECTION_ONLY`, value must `bestMatch` an allowed value (minScore 0.8) or is left out; `multi === false` → one value):

| Aspect name (case-insensitive) | Value |
|---|---|
| Brand | `brand` (`'Unbranded'` if empty and allowed) |
| Size, US Shoe Size | `size` (shoe categories: `sizeSynonyms(size)` matched) |
| Color | colors' labels (first only unless multi) |
| Department | men → `Men`, women → `Women`, kids girls → `Girls`, kids boys → `Boys`, baby → `Baby` (by canonical id `kids.girls_clothing` / `kids.boys_clothing` / `kids.baby_clothing`) |
| Type | canonical leaf label (e.g. `Sneakers`) |
| Material | `material` |
| Model | `model` |
| Size Type | `Regular` |

Final aspects = `{ ...autoAspects, ...data.aspects }` (user wins); empty arrays removed.

### 5.8 `prepare` hook (auto category)

If `isConfigured()` and `data.categoryAuto !== false` and listing has `categoryId`: `s = await suggestCategories(categoryQuery(eff))`; if `s[0]`: `aspects = await getAspects(s[0].categoryId)` → return `{ categoryId, categoryName: path, categoryAuto: true, requiredAspects: aspects.filter(a => a.required).map(a => a.name) }`. On any error log `warn` and return `{}`.

### 5.9 Validation (sync, uses `data` snapshot)

- Connection `not_configured` → error `eBay isn't set up yet. See docs/SETUP.md → Connect eBay.`; not connected → error `Connect eBay in Settings → Marketplaces.`
- Any of `settings.ebay.fulfillmentPolicyId/paymentPolicyId/returnPolicyId` null → error `Choose your eBay shipping, payment and return policies in Settings → Marketplaces → eBay.`; `postalCode` empty → error `Add your ZIP code in Settings → Marketplaces → eBay.`
- No `data.categoryId` → error `Choose an eBay category.`; `categoryAuto` true → warning `eBay category chosen automatically: ${categoryName}. Change it if it's wrong.`
- Each `requiredAspects` name with no value in merged aspects (needs `autoAspects` with a light-weight re-computation that doesn't need the network: brand/size/color/department/type/material/model mapping by name only, ignoring SELECTION_ONLY checks) → error `eBay requires “${name}” for this category.` (field `data.aspects`).

### 5.10 Publish

```text
step auth      "Connecting to eBay"            getUserAccessToken()
step condition "Choosing condition"            conditionId = data.conditionId ?? pickConditionId(l.condition, (await getConditions(cat)).map(c => c.conditionId)) ?? throw API_ERROR 'eBay has no matching condition for this category — choose one in the eBay settings for this item.'
step aspects   "Preparing item specifics"      aspects = merge(autoAspects(l, await getAspects(cat)), data.aspects)
step photos    "Uploading N photos to eBay"    pictureUrls = sequential UploadSiteHostedPictures
step verify    "Checking listing with eBay"    VerifyAddFixedPriceItem(itemXml) → fees = sum of Fees.Fee[].Fee where Name != 'ListingFee'? (log all fees; show total of non-zero fees)
(if !prefs.autoSubmit) requestUser({ reason: 'review_and_submit', title: 'Ready to publish on eBay', instructions: `eBay accepted the listing. Estimated eBay fees now: ${formatCents(fees)}. Click “Publish now” to list it.`, primaryAction: 'Publish now' })
step publish   "Publishing on eBay"            AddFixedPriceItem(itemXml) → ItemID
return { remoteId: ItemID, url: itemPageUrl(ItemID), verified: true }
```

### 5.11 Update, deactivate, status

- `update`: `ReviseFixedPriceItem` with `<Item><ItemID>id</ItemID><Title/><Description/><StartPrice/></Item>` (only those three).
- `deactivate`: if `!prefs.autoSubmit` → `requestUser({ reason: 'confirm_delete', title: 'End eBay listing', instructions: 'Click “End listing” to end this eBay listing.', primaryAction: 'End listing' })`; then `EndFixedPriceItem` `<ItemID>id</ItemID><EndingReason>NotAvailable</EndingReason>`. eBay error code `1047` (already ended) → treat as success.
- `checkStatus`: `GetItem` `<ItemID>id</ItemID><OutputSelector>Item.SellingStatus</OutputSelector><OutputSelector>Item.ListingDetails</OutputSelector>` → `ListingStatus === 'Active'` → `active`; `Completed`/`Ended` with `QuantitySold > 0` → `sold`; else `ended`.

### 5.12 Extra routes (`registerRoutes`, prefix `/api/marketplaces/ebay`)

| Route | Response |
|---|---|
| `GET /categories/suggest?q=` | `suggestCategories(q)` (top 10) |
| `GET /aspects?categoryId=` | `getAspects(id)` |
| `GET /conditions?categoryId=` | `getConditions(id)` |
| `GET /policies` | `getPolicies()` |
| `GET /oauth/callback` | §5.4 |

`describeMapping`: Category (`categoryName`), Condition (label of chosen/pick id if known, else canonical), Item specifics count.

---

## 6. Facebook Marketplace (`marketplaces/facebook/`) — M24

### 6.1 Basics

| Item | Value |
|---|---|
| urls | home `https://www.facebook.com/marketplace/`, sell `https://www.facebook.com/marketplace/create/item`, login `https://www.facebook.com/login/`, myListings `https://www.facebook.com/marketplace/you/selling` |
| listing URL | `https://www.facebook.com/marketplace/item/<id>/`, regex `/\/marketplace\/item\/(\d+)/`, hosts `['facebook.com']` |
| capabilities | publish `assisted`, update `assisted`, deactivate `assisted`, statusCheck `none`, import `url`, **autoSubmitAllowed `false`**, maxPhotos `10`, titleMaxLength `100`, descriptionMaxLength `5000`, minPriceCents `100`, maxPriceCents `null`, requires `['title','price','condition','category']` *(verify)* |
| photoSpec | `{ maxPhotos: 10, maxLongEdge: 2048, quality: 88 }` |
| auth | loginUrlPattern `/\/login|checkpoint/i`; loggedInIndicator `{ role: 'link', name: /^marketplace$/i }`, `{ role: 'button', name: /your profile|account controls/i }`, `{ css: '[aria-label="Your profile" i]' }`; challengeIndicator `{ text: /confirm (it's|that it's) you|security check|checkpoint/i }` |

The UI shows under the Facebook toggle: "Facebook: you'll always click Publish yourself. Facebook may limit new accounts and frequent posting."

### 6.2 Data

```ts
dataSchema = z.object({ ...browserCommonData, hideFromFriends: z.boolean().default(false) });
```

### 6.3 Mapping

```ts
export const FACEBOOK_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['New'], new_without_tags: ['New'], like_new: ['Used - Like New', 'Like New'],
  good: ['Used - Good', 'Good'], fair: ['Used - Fair', 'Fair'], poor: ['Used - Fair', 'Fair'],
};
/** Facebook category = search terms typed into the category combobox (first match wins). */
export const FACEBOOK_CATEGORY_TERMS: Record<string, string[]> = {
  'men.shoes': ["Men's Shoes", 'Shoes'], 'women.shoes': ["Women's Shoes", 'Shoes'], 'kids.shoes': ["Kids' Shoes", 'Shoes'],
  men: ["Men's Clothing", 'Clothing'], women: ["Women's Clothing", 'Clothing'],
  'men.bags': ['Bags & Luggage'], 'women.bags': ['Handbags', 'Bags & Luggage'],
  'men.jewelry': ['Jewelry & Watches', 'Jewelry'], 'women.jewelry': ['Jewelry & Watches', 'Jewelry'],
  'men.accessories.watches': ['Watches', 'Jewelry & Watches'],
  'kids.girls_clothing': ["Kids' Clothing", 'Baby & Kids'], 'kids.boys_clothing': ["Kids' Clothing", 'Baby & Kids'],
  'kids.baby_clothing': ['Baby Clothing', 'Baby & Kids'], 'kids.toys': ['Toys & Games'],
  'home.decor': ['Home Decor'], 'home.kitchen_dining': ['Kitchen & Dining', 'Household'], 'home.bedding_bath': ['Bedding', 'Household'],
  'electronics.phones': ['Cell Phones'], 'electronics.computers_tablets': ['Computers', 'Electronics & Computers'],
  'electronics.video_games': ['Video Games'], 'electronics.audio': ['Audio', 'Electronics & Computers'], 'electronics.cameras': ['Cameras'],
  'collectibles.trading_cards': ['Trading Cards', 'Collectibles'], 'collectibles.vinyl_records': ['Vinyl Records', 'Music'],
  'collectibles.books': ['Books'], 'collectibles.toys_figures': ['Action Figures', 'Toys & Games'],
  other: ['Miscellaneous'],
};
```
Resolution uses `lookupByCategory(FACEBOOK_CATEGORY_TERMS, id)`; `ml.data.categoryPath` / user map values are used as a single search term (last `>` segment).

### 6.4 Selectors *(verify)*

photoInput `css input[type="file"][accept*="image"]` (attached) · photoPreviews `css img[src^="blob:"]`, `css [aria-label*="photo" i] img` · title `label /^title$/i`, `role textbox name /title/i` · price `label /^price$/i`, `role textbox name /price/i` · categoryInput `label /^category$/i`, `role combobox name /category/i` · conditionTrigger `label /^condition$/i`, `role combobox name /condition/i` · description `label /^description$/i`, `role textbox name /description/i` · brand `label /^brand$/i` (optional) · size `label /^size$/i` (optional) · hideFromFriends `role switch name /hide from friends/i`, `label /hide from friends/i` · next `role button name /^next$/i` · publish `role button name /^publish$/i` · listing-menu `role button name /more|options|…/i` · delete `role menuitem name /delete listing/i`, `text /^delete listing$/i` · deleteConfirm `role button name /^delete$/i`.

### 6.5 Publish recipe

photos (required) → title → price (`String(Math.round(priceCents/100))`) → category (`typeahead(categoryInput, terms[0])`, then retry with next terms on `OPTION_NOT_FOUND`) → condition (`chooseOption`) → description → brand (only if control `exists` within 2 s; skip silently otherwise) → size (same) → hide from friends (`setCheckbox`, only if `data.hideFromFriends`) → next (optional field: click **Next** to reach the audience/delivery page).

Never auto-submit (`autoSubmitAllowed: false`). `submitLabel: 'Publish'`. `detectPublished`: race `waitForUrl(/\/marketplace\/item\/(\d+)/)` with `waitForUrl(/\/marketplace\/you\/selling/)`; in the second case call `findAfterManualPublish`. `findAfterManualPublish(page, l)`: `goto(myListings)`, wait 3 s, collect `a[href*="/marketplace/item/"]` with their container `innerText`, pick the first whose text `bestMatch`es `l.title` (score ≥ 0.8), return its ID/URL; else `null`.

### 6.6 Deactivate

`editUrl = ml.url`; steps: click listing menu → click delete; `confirmButton = deleteConfirm`, `confirmLabel: 'Delete'`; `detectDone`: pathname leaves `/marketplace/item/` or text `/deleted/i`. Since autoSubmit is never allowed here, the user always clicks the final Delete.

### 6.7 Update

`editUrl = https://www.facebook.com/marketplace/edit/?listing_id=<id>` *(verify)*; re-fill title, price, description; submit `role button name /^(update|save)/i`.

---

## 7. Grailed (`marketplaces/grailed/`) — M25

### 7.1 Basics

| Item | Value |
|---|---|
| urls | home `https://www.grailed.com/`, sell `https://www.grailed.com/sell/new`, login `https://www.grailed.com/users/sign_up` *(verify)* |
| listing URL | `https://www.grailed.com/listings/<id>-<slug>`, regex `/\/listings\/(\d+)/`, hosts `['grailed.com']` |
| edit URL | `https://www.grailed.com/listings/<id>/edit` *(verify)* |
| capabilities | publish `assisted`, update `assisted`, deactivate `assisted`, statusCheck `browser`, import `browser`, autoSubmitAllowed `true`, maxPhotos `8`, titleMaxLength `60`, descriptionMaxLength `1000`, minPriceCents `100`, maxPriceCents `null`, requires `['title','price','condition','category','brand','size','description']` *(verify)* |
| photoSpec | `{ maxPhotos: 8, maxLongEdge: 2048, quality: 88 }` |
| auth | loginUrlPattern `/sign_up|sign_in|login/i`; loggedInIndicator `{ role: 'link', name: /my items|profile|account/i }`, `{ css: '[data-testid*="avatar" i]' }` |

Validation extra: department must be `men` or `women` → else error `Grailed only accepts menswear and womenswear.`

### 7.2 Mapping

```ts
export const GRAILED_CONDITIONS: Record<Condition, string[]> = {
  new_with_tags: ['New/Never Worn', 'New'], new_without_tags: ['New/Never Worn', 'New'], like_new: ['Gently Used'],
  good: ['Used'], fair: ['Very Worn'], poor: ['Very Worn'],
};
export const GRAILED_CATEGORY_OVERRIDES: Record<string, Array<string | string[]>> = {
  'men.tops.t_shirts': ['Menswear', 'Tops', 'Short Sleeve T-Shirts'],
  'men.tops.shirts': ['Menswear', 'Tops', ['Shirts (Button Ups)', 'Button Ups']],
  'men.tops.polos': ['Menswear', 'Tops', 'Polos'],
  'men.tops.sweaters': ['Menswear', 'Tops', 'Sweaters & Knitwear'],
  'men.tops.sweatshirts_hoodies': ['Menswear', 'Tops', 'Sweatshirts & Hoodies'],
  'men.bottoms.jeans': ['Menswear', 'Bottoms', 'Denim'],
  'men.bottoms.pants': ['Menswear', 'Bottoms', 'Casual Pants'],
  'men.bottoms.shorts': ['Menswear', 'Bottoms', 'Shorts'],
  'men.outerwear.jackets': ['Menswear', 'Outerwear', 'Light Jackets'],
  'men.outerwear.coats': ['Menswear', 'Outerwear', 'Heavy Coats'],
  'men.outerwear.vests': ['Menswear', 'Outerwear', 'Vests'],
  'men.suits_blazers': ['Menswear', 'Tailoring', ['Suits', 'Blazers']],
  'men.activewear': ['Menswear', 'Bottoms', 'Sweatpants & Joggers'],
  'men.swimwear': ['Menswear', 'Bottoms', 'Swimwear'],
  'men.shoes.sneakers': ['Menswear', 'Footwear', ['Low-Top Sneakers', 'Hi-Top Sneakers']],
  'men.shoes.boots': ['Menswear', 'Footwear', 'Boots'],
  'men.shoes.dress_shoes': ['Menswear', 'Footwear', ['Formal Shoes', 'Casual Leather Shoes']],
  'men.shoes.sandals': ['Menswear', 'Footwear', 'Sandals'],
  'men.bags': ['Menswear', 'Accessories', 'Bags & Luggage'],
  'men.accessories.hats': ['Menswear', 'Accessories', 'Hats'],
  'men.accessories.belts': ['Menswear', 'Accessories', 'Belts'],
  'men.accessories.sunglasses': ['Menswear', 'Accessories', 'Sunglasses'],
  'men.accessories.watches': ['Menswear', 'Accessories', 'Jewelry & Watches'],
  'men.accessories.ties': ['Menswear', 'Accessories', 'Ties & Pocketsquares'],
  'men.jewelry': ['Menswear', 'Accessories', 'Jewelry & Watches'],
  'women.tops': ['Womenswear', 'Tops'],
  'women.bottoms': ['Womenswear', 'Bottoms'],
  'women.dresses': ['Womenswear', 'Dresses'],
  'women.outerwear': ['Womenswear', 'Outerwear'],
  'women.shoes': ['Womenswear', 'Footwear'],
  'women.bags': ['Womenswear', ['Bags & Luggage', 'Accessories']],
  'women.accessories': ['Womenswear', 'Accessories'],
  'women.jewelry': ['Womenswear', 'Jewelry'],
};
```
Women's paths stop at category level (subcategory picked by the user → it appears in `missingFields`).

### 7.3 Selectors and recipe *(verify)*

Selectors: photoInput `css input[type="file"]` · department/category `role combobox name /department|category/i`, `label /category/i` · designer `label /designer/i`, `placeholder /designer/i` · size `label /^size/i`, `role combobox name /size/i` · title `label /item name|title/i`, `placeholder /item name/i` · color `label /colou?r/i` · condition `label /condition/i`, `role combobox name /condition/i` · description `label /description/i` · price `label /^price/i` · submit `role button name /^(publish|list item|submit)$/i`.

Recipe: photos (required) → category (`choosePath`) → designer (`typeahead`, `allowCustom: false`) → size (`chooseOption(sizeSynonyms)`) → title → color (`typeahead` or `chooseOption` with the first mapped canonical color label) → condition → description → price (`(priceCents/100).toFixed(0)`). `submitLabel: 'Publish'`; `detectPublished: detectByUrlOrLink(page, /\/listings\/(\d+)/, signal)` (exclude `/listings/<id>/edit`).

Deactivate: edit URL → step click `role button name /^delete( listing)?$/i` → confirm `role button name /^(delete|yes|confirm)/i`, label `Delete`. Update: edit URL, re-fill title/description/price, submit `role button name /^(save|update|publish)/i`.

---

## 8. Adapter checklist (each browser adapter milestone)

1. `mapping.ts` + unit tests (conditions, colors, category paths for every selectable canonical category that the adapter claims to support, parse/build listing URLs).
2. `selectors.ts` + `selectorGroups`.
3. Fixture pages in `fixtures/marketplace-pages/<mp>/` (`sell.html`, `item.html`, `edit.html`, `login.html`).
4. `index.ts` wired through `runBrowserPublish` / `runBrowserDeactivate` / `runBrowserUpdate`.
5. Browser fixture test: publish happy path (autoSubmit on) records every field in `window.__filled` and returns the expected remote ID; publish with a missing control lands in `NEEDS_USER` with that field in `missingFields`, then `continue` with a URL completes `SUCCESS`; deactivate happy path.
6. Register in `registry.ts` (replacing the manual placeholder).
7. Section in `docs/MARKETPLACE_ADAPTERS.md`: what's automated, what the user does, known limitations, calibration notes.
