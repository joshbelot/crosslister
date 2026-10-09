# Implementation Summary

## What was built

Crosslister is a personal, single-user, local-only crosslisting app for a Mac (Fastify + SQLite backend, React frontend, Playwright for browser marketplaces). All 39 milestones of `docs/spec/` are implemented; the browser adapters are **assisted and uncalibrated** — they were built and tested against local HTML fixtures only, never against the live sites or real accounts, and eBay was tested with all HTTP mocked.

- **Phase 1 — core (M1–M17):** shared types/taxonomy/colors/sizes, SQLite schema + migrations, security hooks (Host/Origin/`X-Crosslister`), logging, SSE events, settings, listings CRUD with SKUs and status rules, photo pipeline (originals untouched, derived thumbs/displays, rotate/crop, EXIF-free per-marketplace copies, dHash), validation + effective listing, job runner with the needs-user flow, manual adapter, export (JSON/CSV/ZIP), full frontend (inventory, editor with autosave, cross-list flow, activity drawer, detail, mark sold, settings, logs), docs.
- **Phase 2 — first browser marketplace (M18–M20):** browser manager (persistent profiles), locator/action helpers, calibration script, fixture server, Mercari adapter, connections UI.
- **Phase 3 — more marketplaces (M21–M26):** Poshmark, Depop, eBay (official Trading + REST APIs, OAuth), Facebook, Grailed, and "Update listings" for live items.
- **Phase 4 — import (M27–M32):** staging pipeline + review UI with duplicate detection and merge, eBay API importer, generic JSON-LD/OpenGraph URL importer, shop-page importers, restore from backup ZIP/JSON.
- **Phase 5 — sales (M33–M34):** status checks (API / browser on demand), sale-detected banner, eBay polling.
- **Phase 6 — AI (M35–M38):** Ollama / OpenAI-compatible / Anthropic providers, description and title suggestions, vision attribute suggestions, per-marketplace copy.

### Milestone status

| Milestones | Status |
|---|---|
| M1–M17 (core app) | Done |
| M18–M20 (browser engine, Mercari, connections UI) | Done (Mercari: uncalibrated) |
| M21–M26 (Poshmark, Depop, eBay, Facebook, Grailed, push edits) | Done (browser adapters uncalibrated; eBay untested against real eBay) |
| M27–M32 (import) | Done (shop scans uncalibrated) |
| M33–M34 (status checks, sale detection) | Done |
| M35–M38 (AI) | Done (tested with injected/mocked providers only) |
| M39 (docs and summary) | Done |

## How to run

```bash
npm install
npm run dev        # http://localhost:5173  (server on 127.0.0.1:4317)
npm run typecheck && npm test
npm run test:browser   # Playwright fixture tests; needs Chromium (npx playwright install chromium)
```

## Marketplaces supported

| Marketplace | Method | Publish | Update | Deactivate | Import | Status checks | Calibrated on a real account? |
|---|---|---|---|---|---|---|---|
| eBay | Official API | Automatic | Automatic | Automatic | API | API (+ polling) | No (needs your keys) |
| Mercari | Assisted browser | Fills; you click List | Re-fills title/description/price | Assisted | Shop page / URLs | On demand | No |
| Poshmark | Assisted browser | Fills; you click List | Same | Assisted | Shop page / URLs | On demand | No |
| Depop | Assisted browser | Fills; you click List | Same (no title) | Assisted | Shop page / URLs | On demand | No |
| Grailed | Assisted browser | Fills; you click Publish | Same | Assisted | Shop page / URLs | On demand | No |
| Facebook Marketplace | Assisted browser | Fills; you click Publish | Same | Assisted | URLs | None | No |
| Vinted, OfferUp, Etsy, Other | Manual-assist | Copy fields; you paste the URL | — | You confirm | URLs | None | n/a |

## Marketplace limitations

- No browser adapter has been verified against a live site. Selectors, labels and category trees are best-effort; run `npm run calibrate -- <marketplace>` on your Mac (see `docs/MARKETPLACE_ADAPTERS.md`).
- The app never solves CAPTCHAs, hides automation, autofills credentials or rotates proxies; logins and verification are always done by you in the visible window. Marketplaces (notably Poshmark) may restrict automation in their terms.
- Facebook is fill-only with a low daily limit. Depop's title lives in the description. Poshmark prices are whole dollars.
- eBay needs your own developer keys, business policies and OAuth connection; it has not been run against eBay production or sandbox.
- Browser marketplaces are never polled on a timer; status checks run only when you ask.

## Files created/modified

```text
CLAUDE.md, README.md, IMPLEMENTATION_SUMMARY.md, package.json, vite/vitest/drizzle/tsconfig configs
.github/workflows/ci.yml        typecheck, unit tests, browser tests
docs/                           SETUP, TROUBLESHOOTING, MARKETPLACE_ADAPTERS (+ pre-existing spec/research/architecture)
drizzle/                        generated SQL migrations
fixtures/marketplace-pages/     fixture HTML per marketplace, _shared/fixture.js, _helpers, _import (JSON-LD/OG pages)
src/shared/                     constants, types, zod schemas, taxonomy, colors, sizes, money, text
src/server/
  index.ts, app.ts, config.ts, paths.ts, errors.ts, ids.ts
  db/                           schema, client, migrate
  services/                     logger, events, settings, listings, listingStatus, validation, effectiveListing,
                                marketplaceListings, photos, imageProcessing, jobs, jobRunner, jobContext, crosslist,
                                sales, statusChecks, connections(+Store), secrets, notify, exporter, backup
  routes/                       health, events, logs, settings, listings, photos, marketplaces, jobs, sales, export, import, ai
  browser/                      browserManager, locators, actions, match, extract
  marketplaces/                 types, registry, common, adapterError; manual/, mercari/, poshmark/, depop/, ebay/, facebook/, grailed/
  importers/                    pipeline, duplicates, hash, reverseMapping, urlImporter, browserImporter, backupImport, types
  ai/                           provider, ollama, openaiCompatible, anthropic, prompts, features, images
  scripts/                      calibrate, fixtureServer
src/web/                        api/ (client, hooks, events), lib/, components/ (+ fields, photos, settings), pages/
tests/                          unit/integration per area (shared, db, listings, photos, validation, jobs, sales, export,
                                import, ai, marketplace/*, server), browser/ (Playwright fixtures), helpers/
```

## Decisions made during implementation

- **Test-only env vars (M4):** `CROSSLISTER_LOGS_DIR` overrides the logs directory and `CROSSLISTER_QUIET=1` silences console log output, so tests never write into the repo's `logs/` folder or spam output. Not documented for users.
- **Fastify 4xx errors (M4):** framework-level 4xx errors (e.g. malformed JSON body) are returned as `400 { error: { code: 'BAD_REQUEST' } }` instead of the spec's blanket 500.
- **Dependency majors (M1):** installed versions are newer than the spec assumed (zod 4, nanoid 6, vitest 5, better-sqlite3 13, sharp 0.35, vite 8). The specified behavior is kept; call signatures were adapted where needed.
- **needsAttention vs. hand-resolved failures (M6):** a most-recent `FAILED` publish job no longer flags the listing once its marketplace listing is `active` (e.g. the user used "Mark as listed"); likewise a failed deactivate once the target is `ended`. Otherwise the flag could never clear.
- **Photo upload errors (M7):** per-file failures (unsupported type, 25th photo, unreadable image, HEIC that cannot be converted) are returned in the `errors` array with HTTP 200 so a mixed upload still saves the good files; they are not turned into a request-level 4xx.
- **Photo rendering (M7):** when a manual rotation or crop is set, the EXIF-oriented image is materialized as a fast PNG buffer between steps (sharp cannot reliably chain auto-orient and an explicit rotation in one pipeline). Output is always flattened onto white and written as sRGB JPEG without metadata.
- **Validation signature (M8):** `validateForMarketplace(eff, adapter, canonicalTitle, totalPhotoCount?)` takes an optional 4th argument because `EffectiveListing.photos` is already sliced to the marketplace's photo limit, so the "only the first N photos" warning needs the unsliced count.
- **Adapter hook `categoryPath` (M8):** `MarketplaceAdapter` gained an optional `categoryPath(categoryId)` returning the built-in category path (or `null`). It backs the Settings category map `builtIn` list and `resolveCategoryPath` (05 §1.1).
- **Connection status for manual marketplaces (M8):** with no stored connection row, manual adapters report `connected` ("nothing to connect") and browser/API adapters report `unknown`.
- **Test environment (M9):** `vitest.config.ts` has a `setupFiles` entry (`tests/helpers/setupEnv.ts`) that creates a private temp directory and sets the `CROSSLISTER_*` env vars before any module loads. `createTestApp()` reuses it. This guarantees even statically-imported server modules never touch the repo's `data/` or `logs/`.
- **Job plug-ins (M9):** `registerJobHandler(type, fn)` in `jobRunner.ts` is how later milestones add `status_check` and `import_*` job types without the runner knowing about them. `jobRunner.runOnce()/idle()/abort()` exist for tests.
- **Cancellation / browser closed (M9):** aborting a job's controller with an `AdapterError('BROWSER_CLOSED')` reason makes the job end `FAILED` (not `CANCELLED`) with that message.
- **Vite proxy vs. `src/web/api/` (M10):** the spec puts frontend modules in `src/web/api/*.ts` *and* proxies `/api` to the backend, so Vite's dev server forwarded `/api/hooks.ts` to Fastify (404). `vite.config.ts` adds a `bypass` so `/api/<name>.ts` requests are served by Vite itself.
- **archiver v8 (M15):** the installed `archiver` is ESM-only and exports `ZipArchive` (instead of the default `archiver('zip')` factory shown in the spec); the ZIP contents and behavior are as specified.
- **Settings page (M15):** all tabs share one draft of the full Settings object, so the per-tab **Save** button saves everything that was changed.
- **Browser binary override (M18):** `CROSSLISTER_CHROMIUM_PATH` (undocumented advanced/test env var) points the browser manager, the calibration script and the browser tests at a specific Chromium/Chrome binary. It exists because the sandbox the app was built in could not download the Chromium build that matches the installed Playwright version.
- **Marketplace names in low-level errors (M18):** helper functions in `browser/actions.ts` and `locators.ts` don't know which marketplace they run for, so they throw `AdapterError`s marked "unnamed" (with their parameters); `toAdapterError(err, name)` rebuilds the user message with the real marketplace name (e.g. “…Mercari's page didn't look the way the app expected…”).
- **Fuzzy matching limits (M18):** `bestMatch` follows the spec's scoring literally, so one shared token out of two (e.g. wanted "Extra Large", option "Large") scores 0.65 and counts as a match. Adapters list explicit synonyms first to avoid surprises.
- **Locator preference order (M19):** Playwright's `locator.or()` returns matches in DOM order, so `.first()` alone ignores the spec's "earlier candidates are preferred". `resolveLocator` still waits on the combined locator (as specified) but then returns the first *candidate* (in listed order) that has a visible match. This mattered for Mercari's deactivate dialog, where the page and the dialog both have a "Deactivate" button.
- **Mercari fixtures (M19):** shared fixture helpers live in `fixtures/marketplace-pages/_shared/fixture.js`; every fixture records what was filled in `window.__filled` and, on submit, in `localStorage['cl-filled']` so tests can read it from the item page. `?missing=<ids>` hides controls to simulate a changed website.
- **Registry is built lazily (M23):** the eBay adapter imports services that import the registry, so evaluating the adapter list at module load captured `undefined`. `registry.ts` now builds its list on first use. Adapter error types moved to a dependency-free `marketplaces/adapterError.ts` (re-exported from `common.ts`) for the same reason.
- **eBay XML parser quirk (M23):** `<Item>` is in the spec's `isArray` list, so `GetItem` returns it as an array; `checkStatus` takes the first element. The category-suggestion `path` is ordered root → leaf by `categoryTreeNodeLevel`.
- **eBay extra routes (M23):** besides the spec's routes there is `GET /api/marketplaces/ebay/status` (is it configured? which variables are missing?) and `GET /api/marketplaces/ebay/auto-aspects` (the values the app would fill automatically, shown as "Auto: …" placeholders in the item-specifics editor).
- **Import-cycle fix found by running the real entry point (M26):** `marketplaces/common.ts` pulled in `services/connections.ts`, which imports the registry, which imports every adapter, which import `common.ts` — fine under Vitest's module order, but `tsx src/server/index.ts` crashed with a TDZ error. `upsertConnection`/`getConnection` now live in a leaf module `services/connectionStore.ts`, and `tests/server/startup.test.ts` boots the real entry point so this class of bug fails in CI.
- **Update flow details (M26):** `runBrowserUpdate` re-fills only title, description and price (Depop: description and price, since the title lives in the description) and saves automatically only when `autoSubmit` is on, the adapter allows it, and nothing was left unfilled. The editor's "Push changes?" banner compares the saved title/description/price with the values loaded when the page opened.

- **Import pipeline (M27):** `commitItem` handles the three actions; "merge" only fills fields that are empty on the existing listing (existing values always win) and only adds photos when the listing has none. `commitAll` skips items that already exist or have a duplicate suggestion scoring ≥ 0.45. The import job's step message ("Found N listings…") is updated through a new `ctx.progress(message)`; `photos.addPhotoFromFile` (shared with backup restore) reuses the upload pipeline's `ingestOriginal`.
- **Import photos (M27):** staged photos are re-encoded to JPEG (auto-rotated) into `data/imports/<batchId>/<itemId>/`; the batch folder is deleted with the batch. Browser marketplaces download images through the logged-in browser context (cookies), eBay and others with plain `fetch`. A pause of 3–6 s separates item pages for browser adapters (`CROSSLISTER_IMPORT_DELAY_MS` overrides it, tests set 0).
- **Reverse condition (M29):** bare schema.org words (`New`, `Used`, `Refurbished`, `Damaged`) use the spec's fixed mapping instead of a fuzzy match against the generic labels (which would turn "New" into "New with tags"). Marketplace-specific tables still use "first key wins" (Mercari "Like new" → `new_without_tags`).
- **Generic extraction (M29):** `extractFromHtml(html, baseUrl)` is pure and unit-tested; `extractProduct(page, extra?)` wraps it. Manual marketplaces read pages through the `other` browser profile. The per-adapter `extractExtra` hook exists but no adapter defines one yet (selectors would be guesses without access to the live sites).
- **Shop scans (M30):** the shop/closet URL is only used when a connection has a stored account name (only Poshmark's connect reads it); otherwise the user is asked to open their listings page. Adapter `home` URLs go through `resolveUrl`, so `CROSSLISTER_URL_OVERRIDES` can redirect scans to fixtures. The fixture server serves `<mp>/listing.html` for `/listing/…` paths.
- **Backup restore (M32):** `yauzl` is used for ZIPs; only `export.json` and `listings/<id>/original/*` are extracted (zip-slip safe). A restored listing gets a new id, keeps its SKU if unused, and restores source, sold details, all marketplace rows, and each photo's rotation/crop. Archived state is not restored (listings come back unarchived). `crosslister.db` inside the ZIP is not read — the JSON export is the source of truth.
- **Status checks (M33):** browser adapters implement `checkStatus` through `browserCheckStatus` (JSON-LD availability → sold badge → 404/"not found" text); a login wall returns `unknown`. When several listings of one marketplace are checked at once, later jobs wait 5–10 s first. A pending check for the same listing + marketplace is never duplicated.
- **Sale banner (M34):** `ListingSummary` gained `saleDetectedMarketplaceId` so the global banner can list affected items without loading every detail; the per-page banner on the detail view was removed in favour of the global one. A `registerTick` hook in the job runner (every 60 s) drives eBay polling; the last poll time is stored in the settings table (`ebay_last_poll`).
- **AI (M35–M38):** providers use plain `fetch` with a 120 s timeout. Titles are filtered server-side for length and for words that are not in the item facts, the category labels or a small filler list. Marketplace copy is cut at the marketplace's limits (descriptions at a word boundary) rather than rejected. AI request errors are `AI_ERROR` (502); a disabled provider is `AI_DISABLED` (400). The UI hides every ✨ button when AI is off.

## Known bugs / gaps

- **Browser adapters are uncalibrated against live sites** (Mercari, Poshmark, Depop, Facebook, Grailed): expect to adjust selectors, category trees and shop-scan link patterns on first real use.
- **eBay** was never run against production or sandbox; the full flow is covered by mocked-HTTP tests only.
- **AI** was tested with injected and mocked providers only; real Ollama / LM Studio / Anthropic behaviour (model output quality, vision support of the chosen model) is unverified.
- No per-adapter `extractExtra` selectors exist, so imports from browser marketplaces rely on JSON-LD/OpenGraph data; category, size and condition may need to be chosen in the review step.
- Archived state is not restored from a backup, and `crosslister.db` inside a backup ZIP is only usable by the manual (unzip) restore.
- Windows is untested; HEIC conversion and Keychain storage are macOS-only.
- Test runs in this environment used a pre-installed Chromium via `CROSSLISTER_CHROMIUM_PATH`.

## Next recommended features

1. Calibrate each browser adapter on the real sites (`npm run calibrate`).
2. Apply for Depop's partner API; replace the browser adapter if granted.
3. Etsy API adapter (if selling vintage).
4. Bulk actions in inventory (multi-select cross-list / mark sold).
5. Price drop scheduling.
6. Photo background removal (local model).
