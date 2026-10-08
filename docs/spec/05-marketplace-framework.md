# 05 — Marketplace Framework (M8, M9, M18, M20, M26)

Core code talks to marketplaces **only** through the adapter interface and `registry.ts`. No `if (marketplaceId === 'poshmark')` outside `src/server/marketplaces/<id>/`.

## 1. Adapter interface (`src/server/marketplaces/types.ts`)

```ts
import type { Page } from 'playwright';
import type { z } from 'zod';

export interface DataFieldDef {                 // put this type in src/shared/types.ts (the web renders it)
  key: string;                                  // key inside MarketplaceListing.data
  label: string;
  type: 'text' | 'textarea' | 'number' | 'money' | 'select' | 'tags' | 'boolean' | 'path' | 'ebay_category' | 'ebay_aspects';
  options?: Array<{ value: string; label: string }>; // for 'select'
  help?: string;
  maxItems?: number;                            // for 'tags'
}
// Also add `dataFields: DataFieldDef[]` to MarketplaceInfo in src/shared/types.ts.

export interface EffectiveListing<TData = Record<string, unknown>> {
  listingId: string;
  sku: string;
  marketplaceId: MarketplaceId;
  title: string;                // after override + truncation
  titleTruncated: boolean;
  description: string;          // composed (see §3)
  priceCents: number | null;    // override ?? adjusted base
  msrpCents: number | null;
  condition: Condition | null;
  conditionNotes: string;
  categoryId: string | null;
  categoryLabels: string[];     // canonical labels root→leaf, e.g. ['Men','Shoes','Sneakers']
  department: string | null;    // 'women' | 'men' | ...
  sizeType: SizeType;
  brand: string; model: string; size: string; colors: ColorId[]; material: string;
  quantity: number; measurements: Measurements; tags: string[]; shipping: ShippingInfo;
  photos: PhotoRow[];           // ordered by position, sliced to capabilities.maxPhotos
  photoPaths: string[];         // processed files; [] until the job prepares photos
  data: TData;                  // parsed with adapter.dataSchema (defaults applied)
  dataErrors: string[];         // zod issues if parsing failed (then `data` = schema defaults)
}

export interface PublishResult { remoteId: string | null; url: string | null; verified: boolean }
export type RemoteStatus = 'active' | 'sold' | 'ended' | 'unknown';
export interface ConnectionResult { status: 'connected' | 'logged_out' | 'not_configured'; accountName: string | null; message: string | null }

export interface MarketplaceAdapter<TData = Record<string, unknown>> {
  id: MarketplaceId;
  name: string;
  kind: 'browser' | 'api' | 'manual';
  capabilities: MarketplaceCapabilities;
  photoSpec: PhotoSpec;
  urls: { home: string; sell: string; login?: string; myListings?: string };
  dataSchema: z.ZodType<TData>;
  dataFields: DataFieldDef[];

  /** Marketplace-specific checks; common checks are added by validation.ts (§4). */
  validate(listing: EffectiveListing<TData>): ValidationIssue[];
  /** Mapped values shown in previews and copy panels (e.g. condition label, category path). */
  describeMapping(listing: EffectiveListing<TData>): Array<{ label: string; value: string }>;
  /** Recognize a listing URL of this marketplace (pathname-based; see §8.6). */
  parseListingUrl(url: string): { remoteId: string; url: string } | null;
  /** Build the public URL for a remote id (used when only the id is known). */
  listingUrl(remoteId: string): string;

  connect(ctx: JobContext): Promise<ConnectionResult>;
  publish(ctx: JobContext, listing: EffectiveListing<TData>): Promise<PublishResult>;
  update?(ctx: JobContext, listing: EffectiveListing<TData>, ml: MarketplaceListing): Promise<void>;
  deactivate(ctx: JobContext, ml: MarketplaceListing): Promise<void>;
  checkStatus?(ctx: JobContext, ml: MarketplaceListing): Promise<RemoteStatus>;
  importer?: MarketplaceImporter;               // Phase 4 (07)

  /** Optional: rewrite the composed description (e.g. Depop prepends the title and appends hashtags). Applied at the end of buildEffectiveListing. */
  finalizeDescription?(l: EffectiveListing<TData>): string;
  /** Optional async enrichment run in the background when this marketplace is added as a target or the listing's title/brand/category changes (e.g. eBay auto-suggests a category). Returns a patch merged into ml.data. Must never throw (log and return {}). */
  prepare?(db: Db, listing: Listing, ml: MarketplaceListing): Promise<Record<string, unknown>>;
  /** Optional extra routes under /api/marketplaces/<id>/… (e.g. eBay category search). Called once from buildApp. */
  registerRoutes?(app: FastifyInstance): void;
}
```

Browser adapters additionally satisfy:

```ts
export interface BrowserAdapter<TData = Record<string, unknown>> extends MarketplaceAdapter<TData> {
  kind: 'browser';
  auth: { loginUrl: string; loginUrlPattern: RegExp; loggedInIndicator: LocatorSpec; challengeIndicator?: LocatorSpec };
  listingPathRegex: RegExp;                       // capture group 1 = remote id (used by parseListingUrl, detectors, shop scans)
  selectorGroups: Record<'sell' | 'edit' | 'item' | 'home', LocatorSpec[]>;
  soldIndicator?: LocatorSpec;                    // 08 §3
  readAccountName?(page: Page): Promise<string | null>;
}
```

The registry's array is typed `MarketplaceAdapter<any>[]` (the one permitted `any`: adapters have different `TData`).

Hook wiring:
- `prepare`: `services/marketplaceListings.ts` calls `void runPrepare(db, listingId, mp)` after `PUT …/marketplaces` adds a target and after `PATCH /api/listings/:id` changes `title`, `brand` or `categoryId` (for every target that has `prepare`, status `not_listed` or `error`). `runPrepare` merges the returned patch into `ml.data`, then emits `listing.updated`.
- `registerRoutes`: `buildApp` iterates `allAdapters()` and calls `adapter.registerRoutes?.(scopedApp)` inside a plugin registered with prefix `/api/marketplaces/<id>`.

### 1.1 Category resolution (browser adapters)

Each browser adapter resolves the category path it will click, in this order (first hit wins):
1. `ml.data.categoryPath` — per-listing override, a string like `"Men > Shoes > Sneakers"` (split on `>`; trim).
2. User category map for this marketplace — KV `category_map_<mp>`: `Record<canonicalCategoryId, string>` (same `A > B > C` format), looked up with `lookupByCategory` (exact id, then ancestors). Edited in Settings (04 §10.2).
3. The adapter's built-in map — `buildCategoryPath(categoryId, { synonyms, overrides, skip })` from `marketplaces/common.ts`:
   - `overrides[categoryId]` (via `lookupByCategory`) → explicit `Array<string | string[]>` path, or
   - default: canonical ancestry minus nodes in `skip`, each segment `[node.label, ...(synonyms[node.id] ?? [])]`.
4. None → the category step is skipped and added to `missingFields`; validation shows the warning `Category isn't mapped for {N} — you'll choose it in the browser.`

A path segment of type `string[]` is a list of synonyms; `choosePath` picks the best-matching option among them.

`PhotoSpec`, `PhotoRow` (DB row type `typeof photos.$inferSelect`), `MarketplaceCapabilities`, `ValidationIssue`, `MarketplaceListing` come from 02/03.

## 2. Registry (`src/server/marketplaces/registry.ts`)

```ts
import { manualAdapter } from './manual';
import { mercariAdapter } from './mercari';
// … one import per adapter as milestones land

const adapters: MarketplaceAdapter<any>[] = [
  mercariAdapter, poshmarkAdapter, depopAdapter, facebookAdapter, ebayAdapter, grailedAdapter,
  manualAdapter('vinted', 'Vinted', { home: 'https://www.vinted.com/', sell: 'https://www.vinted.com/items/new' }),
  manualAdapter('offerup', 'OfferUp', { home: 'https://offerup.com/', sell: 'https://offerup.com/' }),
  manualAdapter('etsy', 'Etsy', { home: 'https://www.etsy.com/', sell: 'https://www.etsy.com/your/shops/me/listing-editor/create' }),
  manualAdapter('other', 'Other', { home: 'about:blank', sell: 'about:blank' }),
];
export function getAdapter(id: MarketplaceId): MarketplaceAdapter<any>;   // throws AppError('UNKNOWN_MARKETPLACE', 404, …)
export function allAdapters(): MarketplaceAdapter<any>[];               // in MARKETPLACE_ORDER
```

Until an adapter's milestone is reached, register `manualAdapter(<id>, <name>, <urls>)` in its place (so Phase 1 supports every marketplace manually). Example: in Phase 1 `mercari` is `manualAdapter('mercari', 'Mercari', { home: 'https://www.mercari.com/', sell: 'https://www.mercari.com/sell/' })`.

## 3. Effective listing (`services/effectiveListing.ts`)

```ts
export function buildEffectiveListing(listing: Listing, photos: PhotoRow[], ml: MarketplaceListing, adapter: MarketplaceAdapter, settings: Settings): EffectiveListing;
```

- `title`: `ml.titleOverride ?? listing.title`; if `capabilities.titleMaxLength` and longer → `truncateAtWord(title, max)`, `titleTruncated = true`. If `titleMaxLength === null`, `title` is still set (used as the first description line by adapters like Depop).
- `priceCents`: `ml.priceOverrideCents ?? (listing.priceCents === null ? null : applyPriceAdjust(listing.priceCents, prefs.priceAdjustPercent))`.
- `description`: join with `\n\n`, skipping empty parts:
  1. `ml.descriptionOverride ?? listing.description` (trimmed)
  2. Measurements line if any measurement is set: `Measurements: Chest 22" · Length 28"` (labels: Chest, Waist, Hip, Inseam, Rise, Length, Shoulder, Sleeve, Width, Height, Depth; order as listed; values without trailing `.0`).
  3. `Flaws/notes: ${conditionNotes}` if `conditionNotes` is non-empty **and** not already contained (case-insensitive) in part 1.
  4. `settings.descriptionFooter` if non-empty.
- `photos`: ordered, first `capabilities.maxPhotos`.
- `data`: `adapter.dataSchema.safeParse(ml.data)`; on failure `data = adapter.dataSchema.parse({})` and `dataErrors` = issue messages.
- `notes` and `costCents` are **never** included (private).

## 4. Validation (`services/validation.ts`)

```ts
export function validateCanonical(listing: Listing, photoCount: number): ValidationIssue[];
export function validateForMarketplace(eff: EffectiveListing, adapter: MarketplaceAdapter, canonicalTitle: string): ValidationIssue[];
export function buildValidationReport(db: Db, listingId: string, marketplaceIds?: MarketplaceId[]): ValidationReport;
```

### 4.1 Canonical rules

| Field | Severity | Message |
|---|---|---|
| title empty | error | Add a title. |
| photos = 0 | error | Add at least one photo. |
| price null or 0 | error | Add a price. |
| condition null | error | Choose a condition. |
| categoryId null | error | Choose a category. |
| description empty | warning | Add a description — buyers rarely purchase without one. |
| quantity > 1 | warning | Quantity is only sent to eBay; other marketplaces list one item. |

### 4.2 Common marketplace rules (applied for every adapter, before `adapter.validate`)

Let `cap = adapter.capabilities`, `N = adapter.name`.

| Condition | Severity | Message |
|---|---|---|
| `cap.titleMaxLength` and canonical/override title longer | warning | `Title will be shortened to ${max} characters on ${N}: "${eff.title}"` |
| `eff.description.length > cap.descriptionMaxLength` | error | `Description is ${len} characters; ${N} allows ${max}. Shorten it or write a ${N}-specific description.` |
| price < `cap.minPriceCents` | error | `${N} requires a price of at least ${formatCents(min)}.` |
| `cap.maxPriceCents` and price > max | error | `${N} allows a price of at most ${formatCents(max)}.` |
| `requires` has `brand` and brand empty | error | `${N} requires a brand.` |
| `requires` has `size`, `sizeType ≠ 'none'`, size empty | error | `${N} requires a size.` |
| `requires` has `shippingWeight` and `shipping.weightOz` null | error | `${N} needs the package weight (Shipping → Weight).` |
| `requires` has `msrp` and `msrpCents` null | error | `${N} requires the original retail price (MSRP).` |
| `requires` has `colors` and colors empty | error | `${N} requires a color.` |
| `requires` has `description` and description empty | error | `${N} requires a description.` |
| photo count > `cap.maxPhotos` | warning | `Only the first ${max} photos will be uploaded to ${N}.` |
| each `dataErrors` entry | error | `${N} settings: ${issue}` |

`field` values: `title`, `description`, `priceCents`, `brand`, `size`, `shipping.weightOz`, `msrpCents`, `colors`, `photos`, `data.<key>`.

Canonical **errors** make every marketplace not ready (they are included in each marketplace's issues as well). `ready = issues.every(i => i.severity !== 'error')`. `preview = { title: eff.title, priceCents: eff.priceCents, photoCount: eff.photos.length }`.

## 5. Targets and listing↔marketplace routes (`routes/marketplaces.ts`)

Service `services/marketplaceListings.ts` implements these; routes are thin.

| Method & path | Body | Behavior / response |
|---|---|---|
| `GET /api/marketplaces` | — | `MarketplaceInfo[]` in `MARKETPLACE_ORDER` (includes disabled ones; UI hides disabled in the selector). |
| `POST /api/marketplaces/:mp/connect` | — | Creates a `connect` job; returns `{ job }`. |
| `POST /api/marketplaces/:mp/disconnect` | — | Browser: close context and delete `browser-profiles/<mp>`; eBay: delete eBay secrets. Set connection `logged_out`. Returns `MarketplaceInfo`. |
| `PUT /api/listings/:id/marketplaces` | `{ marketplaceIds }` | Insert `not_listed` rows for new IDs. Remove rows not in the list **only** if status is `not_listed`, `error` or `ended`. Save `last_marketplaces`. Returns `ListingDetail`. |
| `PATCH /api/listings/:id/marketplaces/:mp` | `marketplaceListingPatchSchema` | Updates overrides/data. Empty-string overrides are stored as `null`. Returns `MarketplaceListing`. |
| `DELETE /api/listings/:id/marketplaces/:mp` | — | 409 `TARGET_ACTIVE` if `active` or `in_progress`; else delete row. 204. |
| `GET /api/listings/:id/validation` | `?marketplaceIds=a,b` | `ValidationReport` (default: listing's current targets). |
| `GET /api/listings/:id/marketplaces/:mp/preview` | — | `{ title, titleTruncated, description, priceCents, photoCount, mapping: describeMapping(eff) }` |
| `POST /api/listings/:id/crosslist` | `{ marketplaceIds }` | §7.1 |
| `POST /api/listings/:id/marketplaces/:mp/mark-listed` | `{ url?, remoteId? }` | Manual success: status `active`, `url` (normalized via `parseListingUrl` when possible), `remoteId`, `verified = Boolean(url \|\| remoteId)`, `listedAt=now`, clear errors. |
| `POST /api/listings/:id/marketplaces/:mp/mark-ended` | — | "I removed it myself": status `ended`, `endedAt=now`. |
| `POST /api/listings/:id/marketplaces/:mp/deactivate` | — | §7.3 |
| `POST /api/listings/:id/marketplaces/:mp/update` | — | §7.5 |
| `POST /api/listings/:id/marketplaces/:mp/open-photos` | — | Prepares processed photos, then on macOS runs `open <dir>`; returns `{ path }`. |

After any change: `recomputeListingStatus` + emit `listing.updated`.

## 6. Jobs

### 6.1 Service (`services/jobs.ts`)

```ts
export function createJob(db: Db, j: { type: JobType; marketplaceId: MarketplaceId | null; listingId: string | null; input?: Record<string, unknown>; parentJobId?: string; attempt?: number }): Job;
export function getJob(db: Db, id: string, opts?: { withSteps?: boolean }): Job;
export function listJobs(db: Db, q: { listingId?: string; active?: boolean; limit?: number }): Job[]; // newest first, with steps + listingTitle
export function updateJob(db: Db, id: string, patch: Partial<JobRow>): Job;   // emits job.updated
export function addStep(db: Db, jobId: string, key: string, label: string): JobStep; // state 'running', seq = max+1
export function finishStep(db: Db, stepId: number, state: StepState, message?: string, screenshotPath?: string): void; // emits job.updated
```

### 6.2 Routes (`routes/jobs.ts`)

| Method & path | Behavior |
|---|---|
| `GET /api/jobs?listingId&active=1&limit=50` | `{ items: Job[] }` (active = non-terminal or finished in the last 10 minutes) |
| `GET /api/jobs/:id` | `Job` with steps |
| `POST /api/jobs/:id/continue` body `{ url? }` | 409 `JOB_NOT_WAITING` unless `NEEDS_USER`. Resolves the waiter (§6.4). |
| `POST /api/jobs/:id/cancel` | `NOT_STARTED` → `CANCELLED` immediately; running/waiting → abort signal; final state `CANCELLED`. |
| `POST /api/jobs/:id/retry` | Only `FAILED`/`CANCELLED`. New job: same type/marketplace/listing/input, `attempt+1`, `parentJobId`. Returns new `Job`. |
| `GET /api/jobs/:id/steps/:stepId/screenshot` | Serves the PNG. |

### 6.3 Runner (`services/jobRunner.ts`)

```ts
export const jobRunner: { start(db: Db): void; kick(): void; stop(): Promise<void>; runOnce(): Promise<void> /* tests */ };
```

Concurrency rule: **at most one running job per marketplace; different marketplaces run in parallel; at most 4 running jobs in total.** (While Poshmark waits for the user, Depop can be filling its form.) Jobs without a marketplace (`import_*` with batch-level work) use the batch's marketplace.

Loop: on `kick()` (called after every `createJob`) and every 5 s, pick `NOT_STARTED` jobs ordered by `createdAt` whose marketplace has no running job, up to the global cap, and run `executeJob` without awaiting the others.

`executeJob(job)`:

1. `updateJob(state='IN_PROGRESS', startedAt=now)`; log `info <MP> Starting <type>`.
2. Build `ctx = createJobContext(db, job)` (§6.4).
3. Dispatch:
   - `publish`: `eff = buildEffectiveListing(...)`; `eff.photoPaths = await ctx.step('photos', 'Preparing photos', () => preparePhotosForMarketplace(...))`; `result = await adapter.publish(ctx, eff)`.
   - `update`: same preparation; `await adapter.update!(ctx, eff, ml)`.
   - `deactivate`: `await adapter.deactivate(ctx, ml)`.
   - `connect`: `conn = await adapter.connect(ctx)`; upsert `marketplace_connections`; emit `connection.updated`.
   - `status_check`, `import_scan`, `import_fetch`: see 07/08.
4. Success → apply outcome:
   - `publish`: ml `status='active'`, `remoteId`, `url`, `verified`, `listedAt=now`, `lastError=null`, `lastErrorCode=null`, `lastSyncedAt=now`; job `SUCCESS`, `result={ remoteId, url, verified }`. Log `info <MP> Listing published ID: <remoteId>`.
   - `update`: ml `lastSyncedAt=now`, clear errors.
   - `deactivate`: ml `status='ended'`, `endedAt=now`.
5. Error → `const e = toAdapterError(err, adapter.name)`:
   - `CANCELLED`: job `CANCELLED`; `publish` → ml `status='not_listed'` (or `active` if it was active before — store `previousStatus` in job `input` at creation).
   - otherwise job `FAILED`, `errorCode`, `errorMessage = e.userMessage`; `publish` → ml `status='error'`, `lastError`, `lastErrorCode`; `deactivate`/`update` → ml keeps status, sets `lastError`. Take a screenshot if a page exists. `notifyUser('<MP> failed', e.userMessage)`. Log `error`.
6. `finally`: `recomputeListingStatus`; emit; `browserManager.markIdle(mp)`.

### 6.4 Job context (`services/jobContext.ts`)

```ts
export interface JobContext {
  db: Db; job: Job; marketplaceId: MarketplaceId; adapterName: string;
  settings: Settings; prefs: MarketplacePrefs;
  signal: AbortSignal;
  log: { debug(m: string, d?: unknown): void; info(m: string, d?: unknown): void; warn(m: string, d?: unknown): void; error(m: string, d?: unknown): void };
  /** Required step. Records a step row; on throw marks it failed (+screenshot) and rethrows. */
  step<T>(key: string, label: string, fn: () => Promise<T>): Promise<T>;
  /** Optional step. On throw: step state 'needs_user', message "Couldn't fill automatically — please fill “<label>” in the browser", push label to missingFields, return false. */
  tryStep(key: string, label: string, fn: () => Promise<void>): Promise<boolean>;
  missingFields: string[];
  /** Pause for the user. Resolves when POST /continue arrives. Rejects with CANCELLED on cancel. */
  requestUser(req: NeedsUserRequest): Promise<{ url: string | null }>;
  /** Pause for the user OR resolve automatically when `detect` resolves first (detect gets an AbortSignal that aborts when the user answers). */
  requestUserUntil<T>(req: NeedsUserRequest, detect: (signal: AbortSignal) => Promise<T>): Promise<{ by: 'detected'; value: T } | { by: 'user'; url: string | null }>;
  throwIfCancelled(): void;
  sleep(ms: number): Promise<void>;           // cancellable
  page(): Promise<Page>;                      // browser adapters: browserManager.getPage(mp)
  screenshot(label: string): Promise<string | null>;
}
```

`requestUser` implementation: `updateJob(state='NEEDS_USER', needsUser=req)`; log `info <MP> Waiting for user: <title>`; `notifyUser(req.title, req.instructions)`; if a page exists, `page.bringToFront()`; register a resolver in `waiters: Map<jobId, { resolve, reject }>`; on resolve → `updateJob(state='IN_PROGRESS', needsUser=null)`. Waiting has **no timeout**.

`requestUserUntil`: same, but `Promise.race` between the waiter and `detect(childSignal)`; whichever wins aborts/cleans up the other; state goes back to `IN_PROGRESS`.

### 6.5 Errors (`src/server/marketplaces/common.ts`)

```ts
export class AdapterError extends Error {
  constructor(public code: AdapterErrorCode, public userMessage: string, public detail?: string) { super(userMessage); }
}
export type AdapterErrorCode =
  | 'LOGIN_REQUIRED' | 'NOT_CONNECTED' | 'NOT_CONFIGURED' | 'ELEMENT_NOT_FOUND' | 'OPTION_NOT_FOUND' | 'FILL_FAILED'
  | 'CATEGORY_NOT_SELECTABLE' | 'UPLOAD_FAILED' | 'PUBLISH_NOT_CONFIRMED' | 'BROWSER_CLOSED' | 'NETWORK' | 'TIMEOUT'
  | 'API_ERROR' | 'DAILY_LIMIT' | 'CANCELLED' | 'APP_RESTARTED' | 'UNKNOWN';
export function toAdapterError(err: unknown, marketplaceName: string): AdapterError;
```

Error catalog (`{N}` = marketplace name). For **publish** jobs, the UI always adds the line "Your listing has NOT been marked as listed on {N}."

| Code | User message |
|---|---|
| LOGIN_REQUIRED | You're not logged in to {N}. |
| NOT_CONNECTED | {N} isn't connected yet. Open Settings → Marketplaces and click Connect. |
| NOT_CONFIGURED | {N} isn't set up yet. See Settings → Marketplaces → {N}. |
| ELEMENT_NOT_FOUND | {N}'s page didn't look the way the app expected (couldn't find “{what}”). {N} may have changed its website. |
| OPTION_NOT_FOUND | Couldn't find the option “{value}” for {what} on {N}. |
| FILL_FAILED | Couldn't type into “{what}” on {N}. |
| CATEGORY_NOT_SELECTABLE | The category could not be selected automatically. |
| UPLOAD_FAILED | Photos could not be uploaded to {N}. |
| PUBLISH_NOT_CONFIRMED | The app couldn't confirm that the listing was published on {N}. |
| BROWSER_CLOSED | The {N} browser window was closed before the job finished. |
| NETWORK | Couldn't reach {N}. Check your internet connection. |
| TIMEOUT | {N} took too long to respond. |
| API_ERROR | {N} returned an error: {detail} |
| DAILY_LIMIT | You've reached today's limit for {N} ({limit}). You can change it in Settings. |
| CANCELLED | Cancelled. |
| APP_RESTARTED | The app was restarted while this was running. Check {N} to see whether it went through, then Retry or use “Mark as listed”. |
| UNKNOWN | Something unexpected happened with {N}. Details were written to the log. |

`toAdapterError` mapping: `AdapterError` → itself; Playwright `TimeoutError` → `TIMEOUT`; message contains `Target page, context or browser has been closed` → `BROWSER_CLOSED`; `AbortError`/aborted signal → `CANCELLED`; `fetch failed`/`ENOTFOUND`/`ECONNRESET` → `NETWORK`; else `UNKNOWN` (original message goes to the log, not the UI).

### 6.6 Recovery at startup (`recoverInterruptedJobs`)

- `IN_PROGRESS` or `NEEDS_USER` → `FAILED` with `APP_RESTARTED`; their `in_progress` marketplace listings → `error` with the same message.
- `NOT_STARTED` → `CANCELLED` with message "Cancelled because the app restarted."; their `in_progress` marketplace listings → `not_listed` (or previous status).
- Delete `data/screenshots/*` older than 14 days.

## 7. Flows

### 7.1 Cross-list (`POST /api/listings/:id/crosslist`)

1. Ensure target rows exist for every requested marketplace (insert `not_listed` if missing).
2. Build the validation report for those marketplaces. If any requested marketplace is not ready → `422 { error: { code: 'NOT_READY', message: 'Some marketplaces need more information.', details: report } }`.
3. For each marketplace, in order **api adapters first, then browser, then manual** (within a group, `MARKETPLACE_ORDER`):
   - status `active` → skipped: "Already listed".
   - a non-terminal `publish` job exists → skipped: "Already in progress".
   - publish jobs created today (local date) with state ≠ `CANCELLED` ≥ `prefs.dailyLimit` → skipped: `You've reached today's limit for {N} ({limit}).`
   - otherwise `createJob({ type: 'publish', input: { previousStatus } })`, set ml `status='in_progress'`, clear errors.
4. Save `last_marketplaces`; `jobRunner.kick()`.
5. Response `{ jobs: Job[], skipped: Array<{ marketplaceId, reason }> }`.

### 7.2 Browser publish template (`common.ts → runBrowserPublish`)

All browser adapters implement `publish` by calling this with a recipe:

```ts
export interface BrowserRecipe<TData> {
  fields: Array<{ key: string; label: string; required?: boolean; run: (page: Page, l: EffectiveListing<TData>, ctx: JobContext) => Promise<void> }>;
  submitButton: LocatorSpec;                    // e.g. the "List" button
  submitLabel: string;                          // shown in instructions, e.g. "List"
  detectPublished: (page: Page, l: EffectiveListing<TData>, signal: AbortSignal) => Promise<{ remoteId: string; url: string }>;
  findAfterManualPublish?: (page: Page, l: EffectiveListing<TData>) => Promise<{ remoteId: string; url: string } | null>;
}
export async function runBrowserPublish<TData>(ctx: JobContext, adapter: BrowserAdapter<TData>, l: EffectiveListing<TData>, r: BrowserRecipe<TData>): Promise<PublishResult>;
```

Steps:

1. `step('open', 'Opening {N}')`: `page = await ctx.page()`; `page.goto(adapter.urls.sell, { waitUntil: 'domcontentloaded' })`.
2. `step('login', 'Checking login')`: `await ensureLoggedIn(ctx, adapter, page, adapter.urls.sell)` (§7.4).
3. For each `field` in order: `required ? ctx.step(...) : ctx.tryStep(...)`; `await pace(ctx)` between fields. The **photos** field is always first and `required: true` (step label `Uploading N photos`).
4. Build `copyFields` = Title, Description, Price (`formatCents`), Brand, Size, Condition and Category (from `describeMapping`), Colors, Tags — skipping empty values.
5. Decide submit:
   - `autoSubmit = prefs.autoSubmit && adapter.capabilities.autoSubmitAllowed && ctx.missingFields.length === 0`.
   - **If `autoSubmit`**: `step('submit', 'Publishing')` click `submitButton`; then `step('confirm', 'Confirming')` race `detectPublished` against a 60 s timeout. On timeout: `requestUser({ reason: 'review_and_submit', title: 'Confirm {N} listing', instructions: "The app clicked “{submitLabel}” but couldn't confirm the result. Check the browser window. If the listing is live, paste its URL below and click “It's published”.", allowUrlInput: true, copyFields, primaryAction: "It's published" })`.
   - **Else**: `requestUserUntil({ reason: ctx.missingFields.length ? 'fields' : 'review_and_submit', title: ctx.missingFields.length ? '{N} requires your attention' : 'Review and publish on {N}', instructions: (missing ? "The app couldn't fill: <list>. Fill them in the browser window. " : 'Everything is filled in. ') + "Review the listing and click “{submitLabel}” in the browser. The app will notice when it's published.", missingFields, copyFields, allowUrlInput: true, primaryAction: 'I published it' }, (signal) => r.detectPublished(page, l, signal))`.
6. Result:
   - detected → `{ remoteId, url, verified: true }`.
   - user answered with a URL → `adapter.parseListingUrl(url)` → `verified: true` if parsed, else `{ remoteId: null, url, verified: false }`.
   - user answered without URL → try `adapter.parseListingUrl(page.url())`, then `r.findAfterManualPublish?.(page, l)`; if found `verified: true`; else `{ remoteId: null, url: null, verified: false }` (still marked active — the user asserted it; the detail page shows "unverified").

### 7.3 Deactivate

`POST /api/listings/:id/marketplaces/:mp/deactivate`: 409 `NOT_ACTIVE` unless ml is `active`; create `deactivate` job; kick. Adapters implement `deactivate` with `runBrowserDeactivate(ctx, adapter, ml, recipe)`:

```ts
export interface DeactivateRecipe {
  editUrl: (ml: MarketplaceListing) => string;                     // page that has the delete/deactivate control
  steps: Array<{ key: string; label: string; run: (page: Page, ctx: JobContext) => Promise<void> }>; // e.g. open "…" menu, click "Delete"
  confirmButton: LocatorSpec;                                     // final destructive button in the dialog
  confirmLabel: string;
  detectDone: (page: Page, ml: MarketplaceListing, signal: AbortSignal) => Promise<void>;
}
```

Flow: open `editUrl` → ensure login → run steps with `ctx.step` → if `autoSubmit` click `confirmButton` then `detectDone` (30 s; on timeout ask user) → else `requestUserUntil({ reason: 'confirm_delete', title: 'Remove from {N}', instructions: 'Click “{confirmLabel}” in the browser window to remove the listing from {N}.', primaryAction: "It's removed" }, detectDone)`. If any step throws, convert to a `requestUser` with reason `manual_delist`: "Couldn't find the delete button automatically. Remove the listing in the browser window, then click “It's removed”." (do not fail).

### 7.4 Login handling and connect

```ts
export async function ensureLoggedIn(ctx: JobContext, adapter: BrowserAdapter, page: Page, returnUrl: string): Promise<void>;
```

Each browser adapter provides `auth: { loginUrlPattern: RegExp; loggedInIndicator: LocatorSpec; loginUrl: string }`.

`isLoggedIn(page)` = `!loginUrlPattern.test(page.url())` **and** `loggedInIndicator` resolves within 4 s.

`ensureLoggedIn`: if logged in → return. Else `page.goto(loginUrl)`; `requestUserUntil({ reason: 'login', title: 'Log in to {N}', instructions: "Log in to {N} in the browser window. Complete any verification codes or security checks yourself — the app never sees your password. The app continues automatically once you're logged in.", primaryAction: "I'm logged in" }, pollEvery2s(isLoggedIn))`. Then `page.goto(returnUrl)`. If still not logged in → `AdapterError('LOGIN_REQUIRED')`. Update `marketplace_connections` to `connected`.

The same `requestUser` pattern is used whenever an adapter sees a verification page (adapter `auth.challengeIndicator?: LocatorSpec` checked after navigation): reason `verification`, title `{N} needs you to verify it's you`, instructions "Complete the check in the browser window, then click Continue." **Never interact with CAPTCHA or verification widgets programmatically.**

Browser adapter `connect(ctx)`: `page.goto(urls.home)`; `ensureLoggedIn`; return `{ status: 'connected', accountName: await adapter.readAccountName?.(page) ?? null, message: null }`.

### 7.5 Update live listings (M26)

`POST /api/listings/:id/marketplaces/:mp/update` → `update` job (409 `NOT_ACTIVE` unless active; 409 `UPDATE_UNSUPPORTED` if `capabilities.update === 'none'`). Browser adapters implement `update` with `runBrowserUpdate(ctx, adapter, l, ml, recipe)`: open `editUrl(ml)`, ensure login, `tryStep` re-fill **title, description, price only** (clear then fill), then submit using the same autoSubmit/requestUserUntil logic as publish with `detectSaved` (URL leaves the edit page). Photos, category and other attributes are not changed by updates in V1 (UI says so).

UI trigger: when the user saves edits to title/description/price of a listing that has active marketplace listings, the editor shows a banner "This item is live on Mercari, Poshmark. Push changes?" with **Update listings** (creates update jobs for adapters with `update ≠ 'none'`) and **Not now**.

## 8. Browser engine (`src/server/browser/`)

### 8.1 Browser manager (`browserManager.ts`)

```ts
export const browserManager: {
  getContext(mp: MarketplaceId): Promise<BrowserContext>;
  getPage(mp: MarketplaceId): Promise<Page>;
  hasPage(mp: MarketplaceId): boolean;
  close(mp: MarketplaceId): Promise<void>;
  closeAll(): Promise<void>;
  markIdle(mp: MarketplaceId): void;
};
```

- `getContext`: one `chromium.launchPersistentContext(profileDir(mp), options)` per marketplace, cached in a `Map`. A second concurrent call awaits the same promise.
- Options: `{ headless: process.env.CROSSLISTER_HEADLESS === '1', channel: settings.browser.channel === 'chrome' && !headless ? 'chrome' : undefined, viewport: null, slowMo: settings.browser.slowMoMs, acceptDownloads: false, args: ['--window-size=1280,900'] }`.
- If launching with `channel: 'chrome'` fails (Chrome not installed), log `warn BROWSER "Google Chrome not found, using Playwright Chromium"` and retry without `channel`.
- **Forbidden:** stealth plugins, `ignoreDefaultArgs` to hide automation, user-agent spoofing, `navigator.webdriver` overrides, proxies.
- `getPage`: first existing page of the context, else `context.newPage()`.
- On context `close` event: remove from map; abort the running job for that marketplace with `BROWSER_CLOSED`.
- Idle: `markIdle(mp)` starts a timer of `settings.browser.closeIdleMinutes`; any `getContext(mp)` cancels it; on expiry close the context.
- Profiles persist on disk (`browser-profiles/<mp>/`) so logins survive restarts.

### 8.2 Locators (`locators.ts`)

```ts
export type LocatorCandidate =
  | { role: Parameters<Page['getByRole']>[0]; name: string | RegExp; exact?: boolean }
  | { label: string | RegExp; exact?: boolean }
  | { placeholder: string | RegExp }
  | { testId: string }
  | { text: string | RegExp; exact?: boolean }
  | { css: string };
export interface LocatorSpec { what: string; candidates: LocatorCandidate[] }

export function toLocator(scope: Page | Locator, c: LocatorCandidate): Locator;
export async function resolveLocator(scope: Page | Locator, spec: LocatorSpec, opts?: { timeoutMs?: number; state?: 'visible' | 'attached' }): Promise<Locator>;
export async function exists(scope: Page | Locator, spec: LocatorSpec, timeoutMs?: number): Promise<boolean>;
```

`resolveLocator`: combine candidates with `locator.or()` (`c1.or(c2).or(c3)…`), `const loc = combined.first()`, `await loc.waitFor({ state: opts.state ?? 'visible', timeout: opts.timeoutMs ?? 6000 })`, return `loc`. On timeout throw `AdapterError('ELEMENT_NOT_FOUND', …)` with `spec.what`. Candidate order expresses preference: accessible role/label first, test IDs next, CSS last.

### 8.3 Actions (`actions.ts`)

```ts
export async function fillText(page: Page, spec: LocatorSpec, value: string): Promise<void>;
export async function uploadFiles(page: Page, spec: LocatorSpec, files: string[], opts?: { previews?: LocatorSpec; timeoutMs?: number }): Promise<void>;
export async function chooseOption(page: Page, trigger: LocatorSpec, wanted: string | string[], opts?: { optionScope?: LocatorSpec }): Promise<string>;
export async function choosePath(page: Page, trigger: LocatorSpec | null, path: Array<string | string[]>, opts?: { optionScope?: LocatorSpec }): Promise<void>;
export async function chooseRadio(page: Page, group: LocatorSpec, wanted: string | string[]): Promise<string>; // radios/segmented buttons inside a group
export async function chooseMany(page: Page, trigger: LocatorSpec, wanted: Array<string | string[]>, opts?: { optionScope?: LocatorSpec; doneButton?: LocatorSpec }): Promise<string[]>; // multi-select (colors)
export async function typeahead(page: Page, input: LocatorSpec, value: string, opts?: { allowCustom?: boolean; minScore?: number }): Promise<string>;
export async function setCheckbox(page: Page, spec: LocatorSpec, checked: boolean): Promise<void>;
export async function click(page: Page, spec: LocatorSpec): Promise<void>;
export async function pace(ctx: JobContext): Promise<void>;                // ctx.sleep(random 250–700 ms)
export async function waitForUrl(page: Page, pathRegex: RegExp, signal: AbortSignal, timeoutMs?: number): Promise<string>;
```

Behavior:
- `fillText`: resolve; `click()`; if element is `contenteditable` → `Meta+A` (macOS) / `Control+A`, `Backspace`, `page.keyboard.insertText(value)`; else `fill(value)`. Verify (`inputValue()` or `innerText()`, whitespace-normalized) equals value; if not, `fill('')` then `pressSequentially(value, { delay: 15 })` and verify again; else throw `FILL_FAILED`. (Typing fallbacks exist for React-controlled inputs, not to disguise automation.)
- `uploadFiles`: resolve with `state: 'attached'` (file inputs are often hidden) → `setInputFiles(files)`. If `previews` is given, wait until `count() >= files.length` (default 45 s) else throw `UPLOAD_FAILED`; without `previews`, wait `min(20 s, 2 s × files.length)`.
- `chooseOption`: if the trigger resolves to a native `<select>` → read option texts, `bestMatch`, `selectOption({ label })`. Otherwise click the trigger, wait 400 ms, collect visible option texts within `optionScope` (default: last visible `[role=listbox]`, `[role=menu]`, `[role=dialog]`, else the page) from `[role=option], [role=menuitem], [role=radio], li, button`; `bestMatch(wanted, texts)`; click the element with that exact text. No match → `OPTION_NOT_FOUND`. Returns the chosen text.
- `choosePath`: optionally click trigger; for each segment run the option-collection + `bestMatch` + click, waiting 400 ms between levels. Any miss → `CATEGORY_NOT_SELECTABLE` with the failing segment in `detail`.
- `chooseRadio`: resolve the group; collect `[role=radio], input[type=radio] + label, label, button` texts inside it (radio accessible names via `getByRole('radio')` + `allInnerTexts`/`getAttribute('aria-label')`); `bestMatch`; click/check it. No match → `OPTION_NOT_FOUND`.
- `chooseMany`: click trigger; for each wanted value run option collection + `bestMatch` + click (skip values with no match, logging a warning); click `doneButton` if given, else press `Escape`. Returns chosen texts; throws `OPTION_NOT_FOUND` only if **none** matched.
- `typeahead`: `fillText(input, value)`; wait 900 ms; collect options as above; `bestMatch` (default `minScore` 0.8); click. No match: `allowCustom` → press `Enter` and return value; else `OPTION_NOT_FOUND`.
- `waitForUrl`: resolves when `new URL(page.url()).pathname` matches; listens to `framenavigated` and polls every 1 s; rejects on `signal` abort or optional timeout.

### 8.4 Matching (`match.ts`)

```ts
export function bestMatch(wanted: string | string[], options: string[], minScore = 0.6): { option: string; score: number } | null;
```

For each wanted synonym `w` and option `o` (both `normalizeText`):
- `o === w` → 1.0
- `o.startsWith(w + ' ')` or `w.startsWith(o + ' ')` → 0.9
- `o` contains `w` as whole words → 0.8
- else `j = jaccard(tokenSet(w), tokenSet(o))`; if `j ≥ 0.5` → `0.5 + 0.3 × j`
Best score wins; ties → shorter option; below `minScore` → `null`.

### 8.5 Screenshots

`ctx.screenshot(label)` → `page.screenshot({ path: data/screenshots/<jobId>-<seq>-<label>.png })` if a page exists; stored on the step (`screenshotPath`) and shown in the UI as a thumbnail link. Failures to screenshot are ignored.

### 8.6 URL parsing and fixture overrides

- Adapters parse listing URLs by **pathname regex** plus a host check `hostOk(url, ['mercari.com'])` (suffix match). When `CROSSLISTER_URL_OVERRIDES` is set, host checks are skipped.
- `resolveUrl(mp, key, defaultUrl)`: if env `CROSSLISTER_URL_OVERRIDES` (JSON like `{"mercari":{"sell":"http://127.0.0.1:4399/mercari/sell.html","home":"…","login":"…"}}`) has the key, use it. Adapters read every URL through `resolveUrl`, so fixture tests can point them at local pages.

## 9. Calibration and fixtures

### 9.1 Calibration script (`npm run calibrate -- <marketplace> [page]`)

`src/server/scripts/calibrate.ts`:
1. Parse args: marketplace id (required), page key (`sell` default, or `home`, `edit:<remoteId>`, or a full URL).
2. Launch the marketplace's persistent context **headed** with the real profile (same options as the app; the app must not be running at the same time — if the profile is locked, print "Quit Crosslister first (the browser profile is in use)." and exit 1).
3. Navigate to the page.
4. Print: "Log in if needed and navigate to the page you want to check. Then press Enter here to run the selector check, or type `pause` to open the Playwright Inspector."
5. On Enter: for every `LocatorSpec` in the adapter's exported `selectorGroups[pageKey]`, run `exists(page, spec, 3000)` and print a table `✓/✗  what  (first matching candidate)`.
6. On `pause`: `await page.pause()` (Playwright Inspector → "Pick locator"), then repeat step 4.

Each browser adapter's `selectors.ts` exports `selectorGroups: Record<'sell' | 'edit' | 'item' | 'home', LocatorSpec[]>` covering every spec it uses. `docs/MARKETPLACE_ADAPTERS.md` documents: run calibrate → fix failing specs by adding a candidate at the top of the list → re-run → commit.

### 9.2 Fixture pages and server

- `fixtures/marketplace-pages/<mp>/sell.html` (and `edit.html`, `item.html`, `login.html` where needed): minimal HTML forms whose labels/roles match the **first** candidate of each selector in that adapter's `selectors.ts`, using the same widget style the real site is believed to use (native select vs. custom listbox, typeahead with a suggestion list, hidden file input with preview thumbnails). The submit button's click handler navigates to an item URL matching the adapter's path regex (e.g. `/mercari/us/item/m12345678901/`).
- Fixture pages record what was filled into `window.__filled` (object of field → value) so tests can assert it.
- `src/server/scripts/fixtureServer.ts` exports `startFixtureServer(port = 4399): Promise<{ close(): Promise<void>; url: string }>` (plain `node:http` static server rooted at `fixtures/marketplace-pages`) and, when run directly, starts it and prints the URL.
- These fixtures test our flow logic and helpers, **not** real-site accuracy. Say so in MARKETPLACE_ADAPTERS.md.
