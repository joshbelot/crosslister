# 07 — Import Existing Listings (M27–M32)

Goal: any listing that exists on a marketplace can become a canonical `Listing` in the local database, linked to its marketplace listing, and then be cross-listed elsewhere. Imported and created listings are identical records (`source` is informational only).

Rules: only the user's own listings; one page at a time at human pace (3–6 s between items for browser importers); never bypass logins or challenges (same `requestUser` flow as publishing).

## 1. Concepts

- **Batch** (`import_batches`): one import session from one marketplace with one method: `api` (eBay), `shop_page` (browser scan of the user's shop/closet page), `urls` (pasted listing URLs), `backup` (restore from export).
- **Item** (`import_items`): one remote listing. States: `discovered` → `selected` → `fetched` → `imported` | `merged` | `skipped` (or `failed`).
- Jobs: `import_scan` (discover items), `import_fetch` (read details + download photos for selected items). Both run in the normal job runner (one per marketplace at a time) and show in the Activity drawer. Their `input` holds `{ batchId }`.

## 2. Importer interface (`src/server/importers/pipeline.ts` + adapters)

```ts
export interface DiscoveredItem { remoteId: string; url: string; title: string; thumbUrl: string | null }
export interface ImportedListing {
  remoteId: string; url: string;
  title: string; description: string; priceCents: number | null;
  conditionText: string | null;            // raw marketplace label or schema.org value
  categoryTexts: string[];                 // breadcrumb segments, most general first
  brand: string; size: string; colorTexts: string[];
  photoUrls: string[];
  status: RemoteStatus;                    // active | sold | ended | unknown
  quantity: number;
  extra: Record<string, string>;           // anything else worth keeping in notes (e.g. eBay SKU)
}
export interface MarketplaceImporter {
  methods: Array<'api' | 'shop_page' | 'urls'>;
  scan?(ctx: JobContext): Promise<DiscoveredItem[]>;                 // api / shop_page
  fetch(ctx: JobContext, item: { remoteId: string | null; url: string }): Promise<ImportedListing>;
  downloadPhoto(ctx: JobContext, url: string, dest: string): Promise<void>;
}
export function mapToCanonical(mp: MarketplaceId, imp: ImportedListing): ListingPatch; // shared, uses reverseMapping.ts
```

`mapToCanonical` produces: `title`, `description`, `priceCents`, `condition` (reverse), `categoryId` (reverse), `brand`, `size` (normalized), `colors` (reverse, max 2), `quantity`, `notes` = lines `Imported from <N>: <url>` + `extra` entries (`Key: value`).

## 3. Pipeline (`importers/pipeline.ts`, `routes/import.ts`)

### 3.1 Start a batch — `POST /api/import/batches`

Body `{ marketplaceId, method, urls?: string[] }` (zod: `urls` required for `urls`, each a valid http(s) URL, max 200).
- `api` / `shop_page`: create batch `state='scanning'` + `import_scan` job.
- `urls`: create batch `state='fetching'`; insert one item per URL with `state='selected'` (`remoteId` from `adapter.parseListingUrl(url)` when possible; unparsable URLs are still allowed for manual marketplaces); mark `existingListingId` (§3.5); create `import_fetch` job.
Returns `{ batch, job }`.

### 3.2 `import_scan` job

1. `items = await importer.scan(ctx)` (api) or `await scanShopPage(ctx, adapter)` (§5.3).
2. Insert items `state='discovered'` (dedupe by `remoteId` within the batch), set `existingListingId`.
3. Batch `state='ready'`; emit `import.updated`.

### 3.3 Select — `POST /api/import/batches/:id/fetch { itemIds }`

Selected items → `state='selected'`; batch `state='fetching'`; create `import_fetch` job.

### 3.4 `import_fetch` job

For each `selected` item, sequentially:
1. `step('item-<n>', 'Reading “<title or url>”')`.
2. `imp = await importer.fetch(ctx, item)`.
3. Download up to 24 photos to `data/imports/<batchId>/<itemId>/NN.jpg` with `importer.downloadPhoto` (browser importers use `page.request.get(url)` so the logged-in session is used; eBay uses `fetch`). Convert non-JPEG responses with sharp to JPEG. Skip individual photo failures (log warn).
4. `mapped = mapToCanonical(mp, imp)`; `duplicates = await findDuplicates(db, { draft: mapped, photoPaths, marketplaceId, remoteId })` (§6).
5. Update item: `raw = imp`, `mapped`, `photoPaths`, `duplicates`, `title = imp.title`, `state='fetched'`.
6. Browser importers: `await ctx.sleep(3000 + random 0–3000)` between items.
A failing item → `state='failed'`, `error = userMessage`; continue with the next. At the end batch `state='review'`.

### 3.5 Already-linked detection

If `marketplace_listings` has a row with the same `marketplaceId` and `remoteId`, set `existingListingId`. Such items are unchecked by default in the selection UI and labelled "Already in inventory".

### 3.6 Commit — `POST /api/import/items/:id/commit`

Body `{ action: 'new' | 'merge' | 'skip', targetListingId?: string, overrides?: ListingPatch }`. Item must be `fetched`.

- `new`: `createListing({ ...mapped, ...overrides })` with `source='imported'`; add photos from `photoPaths` through the normal photo pipeline (`addPhotoFromFile(listingId, path, originalFilename)` — refactor 03 §9.1 steps 4–8 into this function); create the marketplace listing row for this marketplace with status from `imp.status` (`active`/`sold`/`ended`; `unknown` → `active`), `remoteId`, `url`, `verified=true`, `lastSyncedAt=now`; if status is `sold`, also set the listing's `soldAt=now`, `soldMarketplaceId`, `soldPriceCents=priceCents`. Item → `imported`, `resultListingId`.
- `merge`: requires `targetListingId`. If the target already has a row for this marketplace with a different `remoteId` → 409 `ALREADY_LINKED` ("That item is already linked to a different <N> listing."). Upsert the marketplace listing row as above. Fill **only empty** canonical fields of the target from `mapped`; add photos only if the target has none. Item → `merged`, `resultListingId = targetListingId`.
- `skip`: item → `skipped`.

`POST /api/import/batches/:id/commit-all` body `{ mode: 'new_without_duplicates' }`: commits every `fetched` item with no `existingListingId` and no duplicate score ≥ 0.45 as `new`; returns counts.

When no item remains in `discovered`/`selected`/`fetched`, batch `state='done'`, `finishedAt=now`.

### 3.7 Other routes

| Route | Response |
|---|---|
| `GET /api/import/batches` | last 20 batches with item counts per state |
| `GET /api/import/batches/:id` | `{ batch, items }` (items without `raw`) |
| `GET /api/import/items/:id/photos/:n` | staged photo file |
| `DELETE /api/import/batches/:id` | deletes batch, items and `data/imports/<batchId>/` |

## 4. Import UI (`ImportPage`)

Three steps on one page, with a list of recent batches below.

1. **Choose source** — radio cards:
   - eBay — "Import active listings via eBay's API" (disabled with reason if eBay isn't connected)
   - Mercari, Poshmark, Depop, Grailed — "Scan your shop page in the browser" and a secondary option "Paste listing URLs"
   - Facebook Marketplace, Vinted, OfferUp, Etsy, Other — "Paste listing URLs"
   - Backup — "Restore from a Crosslister backup (ZIP or JSON)"
   URL mode shows a textarea (one URL per line). **Start** → `POST /api/import/batches` (backup: file picker → `POST /api/import/backup`).
2. **Select** (scan methods): progress text while scanning ("Found 37 listings…" from step updates); then a grid of discovered items (thumb, title, "Already in inventory" tag), checkboxes (Select all / none), **Import selected (N)**.
3. **Review**: one card per fetched item: photo strip, editable mapped fields (title, price, condition, category via `CategoryPicker` — shows "Choose" when null, brand, size), duplicate suggestions (existing listing thumb + title + price + score label "Likely duplicate"/"Possible duplicate" + reasons), and actions **Import as new** · **Merge into this item** (per suggestion) · **Skip**. Top bar: **Import all without duplicates (N)**. Failed items show their error and **Retry** (re-select → fetch).

Edits made in the review card are sent as `overrides` on commit.

## 5. Importers

### 5.1 eBay (`marketplaces/ebay/importer.ts`) — M28

- `methods: ['api']`.
- `scan`: `GetMyeBaySelling` with `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>{n}</PageNumber></Pagination></ActiveList>`; loop pages until `ActiveList.PaginationResult.TotalNumberOfPages`. Item → `{ remoteId: ItemID, url: itemPageUrl(ItemID), title: Title, thumbUrl: PictureDetails.GalleryURL ?? null }`.
- `fetch`: `GetItem` `<ItemID>…</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics>`. Map: `Title`; `Description` HTML → text (`node-html-parser` `parse(html).structuredText`, collapse 3+ newlines to 2); `StartPrice` → cents; `conditionText = String(ConditionID)`; `categoryTexts = PrimaryCategory.CategoryName.split(':')`; Brand / Size / US Shoe Size / Color from `ItemSpecifics`; `PictureDetails.PictureURL[]`; `Quantity - SellingStatus.QuantitySold`; `extra.SKU = SKU` when present; status from `SellingStatus.ListingStatus` (as 06 §5.11).
- Reverse condition for eBay IDs: `1000 → new_with_tags`, `1500/1750 → new_without_tags`, `2750/2990/4000 → like_new`, `3000/5000 → good`, `3010/6000 → fair`, `7000 → poor`, others → `good`.
- `downloadPhoto`: plain `fetch`.

### 5.2 Generic URL importer and extractors (`browser/extract.ts`) — M29

Used by `urls` method for every marketplace and as the base of browser `fetch`. Page source: the marketplace's persistent browser context (manual marketplaces use profile `other`). Navigate with `waitUntil: 'domcontentloaded'`, wait 2 s, then run `ensureLoggedIn` only if the adapter is a browser adapter and the page shows a login wall (`auth.loginUrlPattern` matches).

```ts
export interface ExtractedProduct { title?: string; description?: string; priceCents?: number; currency?: string; images: string[]; brand?: string; condition?: string; color?: string; size?: string; category?: string[]; availability?: 'active' | 'sold' | 'ended' }
export async function extractProduct(page: Page): Promise<ExtractedProduct>;
```

Extraction chain (earlier sources win per field; `images` are unioned in order, de-duplicated by URL without query string):
1. **JSON-LD**: every `script[type="application/ld+json"]` → `JSON.parse` (ignore failures) → flatten arrays and `@graph` → first object whose `@type` is or includes `Product`. Map `name`, `description`, `image` (string | string[] | `{ url }`), `brand` (string | `{ name }`), `offers` (object or array; `price`, `priceCurrency`, `availability`), `itemCondition` (`…/NewCondition` → `New`, `UsedCondition` → `Used`, `RefurbishedCondition` → `Refurbished`, `DamagedCondition` → `Damaged`), `color`, `size`, `category` (string split on `>` or `/`).
2. **Meta tags**: `og:title`, `og:description`, every `og:image`, `product:price:amount`, `product:price:currency`, `product:brand`, `product:condition`, `product:availability`.
3. **Adapter extras**: `adapter.importer.extractExtra?.(page)` → partial `ExtractedProduct` (selectors for breadcrumb/category, size, condition, brand on the item page; *(verify)*).

Availability mapping: `InStock`/`in stock` → `active`; `SoldOut`/`OutOfStock`/`sold` → `sold`; `Discontinued` → `ended`; missing → `unknown`.

### 5.3 Shop page importers — M30

```ts
export function createBrowserImporter(adapter: BrowserAdapter, opts: {
  shopUrl?: (accountName: string | null) => string | null;
  extractExtra?: (page: Page) => Promise<Partial<ExtractedProduct>>;
}): MarketplaceImporter;
export async function scanShopPage(ctx: JobContext, adapter: BrowserAdapter): Promise<DiscoveredItem[]>;
```

`scanShopPage`:
1. `page.goto(shopUrl(accountName) ?? adapter.urls.home)`; `ensureLoggedIn`.
2. If `shopUrl` returned null: `requestUser({ reason: 'other', title: 'Open your listings on <N>', instructions: 'In the browser window, go to the page that shows all of your own listings (your shop or closet). Then click Continue.', primaryAction: 'Continue' })`.
3. Loop: collect all `a[href]` whose pathname matches the adapter's listing regex → `{ remoteId, url (absolute, no query), title: (anchor innerText || img alt).trim().slice(0, 200), thumbUrl: first img src }`; `window.scrollBy(0, window.innerHeight * 0.9)`; `ctx.sleep(1500)`; stop after 3 rounds without new items or at 500 items. Update the step message "Found N listings…" each round.

Shop URLs: Poshmark `https://poshmark.com/closet/<accountName>`; Depop `https://www.depop.com/<accountName>/`; Mercari and Grailed: `null` (user navigates) *(verify)*.

Wire `importer` into Mercari, Poshmark, Depop, Grailed adapters with `methods: ['shop_page', 'urls']`. Facebook and manual adapters use `methods: ['urls']` via a generic `createUrlImporter(adapter)`.

### 5.4 Restore from backup — M32

`POST /api/import/backup` (multipart, one file: `.zip` from 10 §3 or `.json` from 10 §1):
1. ZIP → extract to `data/tmp/restore-<batchId>/` (use `node:zlib` + a minimal unzip? → **use the `yauzl` package**; add it to dependencies in this milestone). JSON → read directly.
2. Validate `exportVersion === 1` (else 400 `UNSUPPORTED_BACKUP`).
3. Batch `method='backup'`, `marketplaceId='other'`, `state='review'`; one item per exported listing with `mapped` = the exported canonical fields, `raw` = exported listing incl. marketplace rows, `photoPaths` = extracted original photo files (ZIP only; ordered by exported position), `existingListingId` = local listing with the same `id` or `sku`, `state='fetched'`.
4. Commit `new` for backup items: create with **a new id**, keep the exported `sku` if unused (else allocate), restore all marketplace listing rows (status, remoteId, url, overrides, data), and photos with their rotation/crop. `merge` behaves as in §3.6 for each marketplace row.

## 6. Duplicate detection (`importers/duplicates.ts`) — M31

```ts
export async function findDuplicates(db: Db, q: { draft: ListingPatch; photoPaths: string[]; marketplaceId: MarketplaceId; remoteId: string | null }): Promise<Array<{ listingId: string; score: number; reasons: string[] }>>;
```

1. Same `(marketplaceId, remoteId)` linked → return `[{ listingId, score: 1, reasons: ['Same <N> listing ID'] }]`.
2. Candidates: all non-archived listings.
3. Hash the first 3 import photos (`computeDhash`). For each candidate compare with its first 6 photos' stored `dhash`; `d` = minimum Hamming distance.
4. Score:
   - `d ≤ 6` → +0.5 "Very similar photo"; `7 ≤ d ≤ 12` → +0.3 "Similar photo"
   - `j = jaccard(tokenSet(draft.title), tokenSet(candidate.title))` → +0.25 × j; reason "Similar title" when `j ≥ 0.6`
   - brand both non-empty: equal (normalized) → +0.1 "Same brand"; different → −0.2
   - size both non-empty: equal → +0.1 "Same size"; different → −0.2
   - prices within 20% of each other → +0.05 "Similar price"
   - clamp to [0, 1]
5. Return candidates with score ≥ 0.45, highest first, max 3. Label: ≥ 0.7 "Likely duplicate", else "Possible duplicate". **Never merge automatically** (only the exact remote-ID case marks "Already in inventory", and even that requires the user to act).

## 7. Reverse mapping (`importers/reverseMapping.ts`)

```ts
export function reverseCondition(mp: MarketplaceId, text: string | null): Condition | null;
export function reverseCategory(categoryTexts: string[], title: string): string | null;
export function reverseColors(texts: string[]): ColorId[];
```

- `reverseCondition`: eBay → numeric table (§5.1). Others: `bestMatch(text, all labels in that adapter's condition table)` → the canonical key whose list contains the matched label (first key wins, so `New` on Mercari → `new_with_tags`); schema.org words: `New` → `new_without_tags` (or `new_with_tags` if the description contains "tags"), `Used` → `good`, `Refurbished` → `like_new`, `Damaged` → `poor`. Unknown → `null`.
- `reverseCategory`: tokens `T = tokenSet([...categoryTexts, title].join(' '))`. Department hint from tokens: `men|mens|man` → men, `women|womens|woman|ladies` → women, `kids|boys|girls|baby|toddler` → kids. For each selectable canonical category compute `jaccard(T, tokenSet(path labels + all adapters' synonyms for its nodes))`, +0.2 if its department equals the hint, −0.3 if a hint exists and differs. Best score ≥ 0.35 → its id; else `null` (user chooses in review).
- `reverseColors`: for each text, `bestMatch` against `COLORS` labels plus synonyms `grey→gray`, `multi|multicolour→multicolor`, `burgundy|maroon→red`, `khaki|olive→green`, `ivory|off white→cream`, `camel→tan`; unique, max 2.
