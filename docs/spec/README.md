# Crosslister Implementation Spec

This folder is a complete, step-by-step build plan. An implementing agent should be able to build the whole app from it **without making product or architecture decisions**. Read this file first, then work through the milestones in order.

## Files

| File | Contents |
|---|---|
| [01-project-setup.md](01-project-setup.md) | Repo layout, dependencies, scripts, config files, `.gitignore`, `.env.example` |
| [02-data-model.md](02-data-model.md) | Shared types, zod schemas, canonical taxonomy, colors, DB schema, status rules |
| [03-backend-core.md](03-backend-core.md) | Server bootstrap, security, logging, events, settings, listings, photos, image processing, API routes |
| [04-frontend.md](04-frontend.md) | Every page, component and interaction, keyboard shortcuts |
| [05-marketplace-framework.md](05-marketplace-framework.md) | Adapter interface, registry, effective listing, validation, job runner, needs-user flow, browser engine, helpers, calibration |
| [06-marketplace-adapters.md](06-marketplace-adapters.md) | Per-marketplace adapters: Manual, Mercari, Poshmark, Depop, eBay, Facebook, Grailed |
| [07-import.md](07-import.md) | Import pipeline, extractors, review UI, duplicate detection, merge |
| [08-sales-delisting.md](08-sales-delisting.md) | Mark sold, deactivate elsewhere, status checks, sale detection |
| [09-ai.md](09-ai.md) | Optional AI provider, prompts, suggestion UI |
| [10-export-backup.md](10-export-backup.md) | JSON/CSV export, ZIP backup, restore |
| [11-testing.md](11-testing.md) | Test setup and the exact test cases required |
| [12-docs-and-delivery.md](12-docs-and-delivery.md) | Documentation to write, `IMPLEMENTATION_SUMMARY.md` template, definition of done |

Background: [`../MARKETPLACE_RESEARCH.md`](../MARKETPLACE_RESEARCH.md) (why each marketplace is built the way it is) and [`../ARCHITECTURE.md`](../ARCHITECTURE.md) (decision table).

## Rules for the implementing agent

1. **Follow the spec literally.** Names of files, functions, routes, tables, columns, types and UI labels are part of the spec. Do not rename.
2. **Work milestone by milestone** (list below). After each milestone: run `npm run typecheck` and `npm test`; both must pass; then commit with message `M<n>: <title>`.
3. **When the spec is silent**, choose the simplest option consistent with nearby code and record it under "Decisions made during implementation" in `IMPLEMENTATION_SUMMARY.md`. Do not add features that are not specified.
4. **When a library's current API differs** from a snippet in this spec (libraries get new majors), keep the specified *behavior* and adapt the call to the installed version's documentation. Record it in the summary.
5. **You cannot reach real marketplaces from your environment and have no accounts.** Never claim an adapter is verified against a live site. Browser adapters are built against local HTML fixtures and the best-known selectors in `06`; the user calibrates them on their Mac (procedure in `05` §9). Mark them "assisted, uncalibrated" in the summary.
6. **Never** add CAPTCHA solving, stealth plugins, fingerprint spoofing, credential autofill, proxy rotation, or anything that hides automation. Never store marketplace passwords.
7. **Never commit** `data/`, `browser-profiles/`, `logs/`, `.env`, screenshots, or any token.
8. Keep it boring: no extra services, no Docker, no auth, no multi-user code, no event bus, no monorepo tooling.
9. TypeScript `strict` everywhere. No `any` except in narrowly-typed parsing helpers with a comment.
10. Every user-visible error must be a sentence a non-programmer understands (see error catalog in `05` §6).

## Milestones

Each milestone lists the spec sections it implements. "Done when" items are mandatory.

### Phase 1 — Core application (no marketplace automation)

| # | Milestone | Spec | Done when |
|---|---|---|---|
| M1 | Scaffold project | 01 | `npm install && npm run dev` serves a placeholder page at http://localhost:5173 and `GET /api/health` returns `{ ok: true }` via the Vite proxy. `npm run typecheck`, `npm test` pass (one trivial test). |
| M2 | Shared types, taxonomy, colors, zod schemas | 02 §1–§5 | All shared files exist and compile; taxonomy unit tests pass. |
| M3 | DB schema + migrations + DB client | 02 §6–§8 | `npm run db:generate` produces a migration; server applies it at startup; DB tests pass. |
| M4 | Server core: config, security hooks, logger, event bus, error handler | 03 §1–§6 | Requests with a foreign `Host`/`Origin` are rejected (test). Logs go to DB, console and `logs/`. |
| M5 | Settings service + routes | 03 §7 | `GET/PUT /api/settings` with defaults and validation; tests pass. |
| M6 | Listings service + routes | 03 §8 | CRUD, duplicate, archive, search/filter, SKU allocation, status recompute; tests pass. |
| M7 | Photos + image processing | 03 §9–§10 | Upload (incl. HEIC on macOS), originals untouched, derived thumb/display, reorder, rotate, crop, delete, serving; tests pass. |
| M8 | Marketplace framework A: types, registry, effective listing, validation, targets routes, manual adapter | 05 §1–§5, 06 §1 | `GET /api/listings/:id/validation` returns per-marketplace readiness; tests pass. |
| M9 | Marketplace framework B: job runner, SSE, jobs routes, cross-list route, manual publish flow | 05 §6–§7 | Cross-listing with the manual adapter goes NOT_STARTED → NEEDS_USER → SUCCESS when the user pastes a URL; tests pass. |
| M10 | Frontend shell | 04 §1–§3 | Layout, router, API client, SSE hook, toasts, Activity drawer skeleton. |
| M11 | Inventory page | 04 §4 | Filters with counts, search, sort, badges, keyboard shortcuts. |
| M12 | Listing editor (new + edit) with photo manager | 04 §5–§6 | Create a listing with 10 photos in < 2 minutes; autosave works; reorder/rotate/crop/delete/primary. |
| M13 | Cross-list modal + Activity drawer + needs-user cards | 04 §7–§8 | Full manual-adapter cross-list from the UI. |
| M14 | Listing detail page + mark sold + manual deactivate | 04 §9, 08 §1–§2 | Mark sold → deactivate-elsewhere modal → jobs (manual adapter asks user to confirm). |
| M15 | Settings page + export/backup | 04 §10, 10 | JSON, CSV export and ZIP backup download. |
| M16 | Logs page | 04 §11 | Filterable logs. |
| M17 | Phase 1 docs | 12 §1 | README, SETUP, TROUBLESHOOTING, MARKETPLACE_ADAPTERS drafts exist. |

### Phase 2 — First browser marketplace

| # | Milestone | Spec | Done when |
|---|---|---|---|
| M18 | Browser engine: manager, helpers, screenshots, calibration script, fixture server | 05 §8–§9 | Helper tests pass against fixtures (`npm run test:browser`). |
| M19 | Mercari adapter (connect, publish, deactivate) | 06 §2 | Fixture flow test passes; mapping/validation unit tests pass. |
| M20 | Marketplace connections UI (connect/log-in check) | 04 §10.2, 05 §7.4 | "Connect" opens the persistent browser at the login page; status shows Connected after login. |

### Phase 3 — Additional marketplaces

| # | Milestone | Spec |
|---|---|---|
| M21 | Poshmark adapter | 06 §3 |
| M22 | Depop adapter | 06 §4 |
| M23 | eBay adapter (OAuth, policies, taxonomy, publish, revise, end) | 06 §5 |
| M24 | Facebook Marketplace adapter | 06 §6 |
| M25 | Grailed adapter | 06 §7 |
| M26 | Push edits to live listings ("Update listings") | 05 §7.5, 06 per adapter |

### Phase 4 — Import

| # | Milestone | Spec |
|---|---|---|
| M27 | Import framework: staging table, jobs, review UI | 07 §1–§4 |
| M28 | eBay importer | 07 §5.1 |
| M29 | Generic URL importer (JSON-LD / OpenGraph) | 07 §5.2 |
| M30 | Shop-page importers (Mercari, Poshmark, Depop, Grailed) | 07 §5.3 |
| M31 | Duplicate detection + merge | 07 §6 |
| M32 | Restore from JSON export (import backup) | 07 §5.4 |

### Phase 5 — Sales & delisting automation

| # | Milestone | Spec |
|---|---|---|
| M33 | Status checks (eBay API, browser on-demand) | 08 §3 |
| M34 | Sale detection banner + eBay polling | 08 §4 |

### Phase 6 — AI (optional)

| # | Milestone | Spec |
|---|---|---|
| M35 | AI provider + settings + health check | 09 §1–§3 |
| M36 | Description + title suggestions | 09 §4.1–§4.2 |
| M37 | Photo attribute suggestions (vision) | 09 §4.3 |
| M38 | Marketplace-specific optimization | 09 §4.4 |

### Delivery

| # | Milestone | Spec |
|---|---|---|
| M39 | Final docs + `IMPLEMENTATION_SUMMARY.md` | 12 |

Stopping point: if time is limited, finish whole milestones in order. Phase 1 + Phase 2 is the minimum useful product; Phase 3 delivers the success criteria.
