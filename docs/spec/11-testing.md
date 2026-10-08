# 11 — Testing

Vitest, Node environment. The suite must **never** touch real marketplaces, real accounts, the real Keychain or the user's data folder.

## 1. Commands

- `npm test` — all unit/integration tests (no browser).
- `npm run test:browser` — Playwright fixture tests in `tests/browser/` (`RUN_BROWSER_TESTS=1`, headless Chromium via `CROSSLISTER_HEADLESS=1`). Each file starts with `describe.skipIf(!process.env.RUN_BROWSER_TESTS)(…)`.
- Both run in CI (01 §12).

## 2. Test harness (`tests/helpers/`)

`testApp.ts`:

```ts
export async function createTestApp(): Promise<{ app: FastifyInstance; db: Db; dataDir: string; cleanup(): Promise<void> }>;
```
- Creates a temp dir (`fs.mkdtemp(os.tmpdir() + '/crosslister-test-')`), sets `process.env.CROSSLISTER_DATA_DIR`, `CROSSLISTER_PROFILES_DIR`, `CROSSLISTER_SECRETS_BACKEND=file` **before** dynamically importing server modules (`await import('../../src/server/app')`), opens a DB in the temp dir, runs migrations, `buildApp({ db, startJobRunner: false })`.
- Requests use `app.inject({ method, url, headers: { host: '127.0.0.1:4317', 'x-crosslister': '1', origin: 'http://127.0.0.1:5173' }, payload })` via a helper `req(app, method, url, body?)`.
- `cleanup` closes app/DB and removes the temp dir.
- Use `vi.resetModules()` between files if config caching causes leaks; each test file gets its own app.

`fixtures.ts`:
- `makeJpeg(width, height, color)` → Buffer via sharp (solid color + a drawn rectangle so dHashes differ by color/shape), `makePng`, and a tiny EXIF-rotated JPEG (`sharp(...).withMetadata({ orientation: 6 })`).
- `multipart(files: Array<{ name: string; buffer: Buffer; type: string }>)` → `{ payload, headers }` for `app.inject` (build with `FormData` + `Response` to get the encoded body, or hand-build the boundary).
- `seedListing(app, overrides?)` → created `ListingDetail` with a photo.

Fake adapter for job tests: `tests/helpers/fakeAdapter.ts` — a `MarketplaceAdapter` whose `publish` runs scripted steps (success, throw `AdapterError`, `requestUser`, `requestUserUntil` with a controllable detector). Tests register it via an exported test-only `__setAdaptersForTest(adapters)` in `registry.ts`.

## 3. Required test cases

### tests/shared/
- `taxonomy.test.ts`: every leaf selectable, parents exist, `categoryPathLabel`, `sizeTypeOf` inheritance (`men.shoes.sneakers` → `shoe_men`, `women.bottoms.jeans` → `waist`), `lookupByCategory` falls back to ancestors.
- `money.test.ts`: `parsePriceToCents` (`"$65"`, `"65.5"`, `"1,200.00"`, `""`, `"abc"`, `"-5"`, `"1.999"`), `formatCents`, `applyPriceAdjust` (0%, +10% rounding, −20%).
- `text.test.ts`: `normalizeText` (diacritics, punctuation), `truncateAtWord`, `jaccard`.
- `sizes.test.ts`: `normalizeSize`, `sizeSynonyms`.

### tests/listings/
- create with defaults (SKU `CL-00001`, then `CL-00002`; shipping copied from settings).
- patch validation errors (unknown category, >2 colors, negative price) → 400 with `VALIDATION`.
- search across title/brand/sku; filters and counts; sort with null prices last.
- status recompute: draft → ready (when canonical valid) → partially_listed → listed → sold → archived.
- needsAttention cases (02 §8).
- duplicate copies fields and photo files, new SKU, targets `not_listed`.
- delete refuses with active target (409) and succeeds with `force=1`, removing the folder.
- empty-draft cleanup only removes old empty drafts.

### tests/photos/
- upload JPEG/PNG: original bytes identical (sha256 of file on disk equals upload), thumb/display exist, dimensions correct, EXIF orientation 6 swaps width/height.
- duplicate upload skipped with a note; unsupported extension error; 25th photo rejected.
- reorder (and mismatch 400); rotate bumps version and changes display dimensions; crop changes display size; rotation resets crop; delete re-numbers positions and removes files.
- processed marketplace copies: count limited by `maxPhotos`, `01.jpg…` order follows positions, max long edge respected, **no EXIF/GPS** in output (`sharp(file).metadata()` has no `exif`).
- dHash stable for the same image, different for different images; Hamming distance.
- HEIC: on non-macOS without HEIF support, upload returns the `HEIC_UNSUPPORTED` message (skip test on darwin).

### tests/validation/
- each canonical rule; each common marketplace rule (title truncation warning with the truncated text, description too long error, min price, requires brand/size/msrp/weight, photo count warning, data schema errors); `ready` flag; preview values; price adjust applied; overrides win; description composition (measurements line, condition notes de-duplication, footer).

### tests/jobs/
- crosslist creates jobs in order api → browser → manual; skips active, in-progress and daily-limit cases with reasons; 422 when not ready.
- runner: one job per marketplace at a time, parallel across marketplaces, global cap 4.
- success path updates marketplace listing (`active`, remoteId, url, verified) and listing status.
- failure path: job `FAILED` with catalog message; ml `error`; listing **not** listed.
- `requestUser` → `NEEDS_USER` → `POST /continue { url }` → `SUCCESS` with parsed URL; `continue` on a non-waiting job → 409.
- `requestUserUntil` resolves by detection and clears `NEEDS_USER`.
- cancel while waiting → `CANCELLED`, ml back to previous status; retry creates attempt 2 with `parentJobId`.
- `tryStep` failure adds to `missingFields` and step state `needs_user`.
- recovery at startup (06 §6.6).
- `toAdapterError` mappings.

### tests/marketplace/<id>/ (one folder per adapter)
- manual: publish waits for user, URL parsed, `verified` false without URL; deactivate asks the user; Etsy warning.
- mercari/poshmark/depop/facebook/grailed `mapping.test.ts`: condition tables cover all 6 conditions; color tables cover all 18 colors; `buildCategoryPath` for representative categories (sneakers, jeans, t-shirts, dresses, unmapped → null); `parseListingUrl` positive/negative cases (incl. Depop `/products/create/` rejected, Grailed `/edit` rejected); adapter-specific helpers (`mercariShippingWeight`, `depopParcelSize`, Depop `finalizeDescription` with hashtags, Poshmark whole-dollar warning, Grailed department error).
- ebay: `buildItemXml` snapshot (escaping, CDATA, optional blocks), `descriptionToHtml`, `pickConditionId`, `categoryQuery`, `autoAspects` (SELECTION_ONLY matching, multi), `tradingCall` error parsing from fixture XML (`tests/marketplace/ebay/fixtures/*.xml`) with `fetch` mocked via `vi.spyOn(globalThis, 'fetch')`, token refresh caching and `invalid_grant` → `NOT_CONNECTED`, validation messages, `prepare` hook with mocked REST, publish flow end-to-end with all HTTP mocked (upload pictures → verify → add) and `autoSubmit=false` pausing before AddFixedPriceItem, end listing with error 1047 treated as success, OAuth callback resuming the connect job.

### tests/browser/ (opt-in; fixture server from 05 §9.2)
- helpers: `resolveLocator` picks the first visible candidate and throws `ELEMENT_NOT_FOUND` with `what`; `fillText` on input, textarea, contenteditable and a React-like controlled input that ignores `fill` (fixture page simulates by resetting value on `input` events once); `uploadFiles` waits for previews; `chooseOption` with native select and custom listbox; `choosePath` 3 levels with synonyms; `chooseRadio`; `chooseMany`; `typeahead` exact and custom; `bestMatch` table tests (also unit-level in tests/shared).
- per adapter (05 §9.2, 06 §8 item 5): happy path, missing-control path, deactivate path, login path (fixture `login.html` → the test clicks the fixture "Log in" button to simulate the user → flow continues).

### tests/export/
- per 10 §5.

### tests/import/
- extractors on fixture HTML (JSON-LD Product with offers array, `@graph`, OpenGraph-only page, availability mapping).
- reverse mapping (conditions per marketplace, categories from breadcrumbs, colors).
- duplicates scoring (photo, title, brand/size penalties, remote-ID exact match).
- pipeline with a fake importer: scan → select → fetch → commit new/merge/skip, `ALREADY_LINKED` conflict, commit-all, backup restore from a generated ZIP.

### tests/ai/
- per 09 §5.

## 4. Coverage expectations

No numeric target. Every service function and every route has at least one test; every adapter mapping table is fully covered by tests.
