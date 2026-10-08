# Implementation Summary

(Work in progress — completed in M39 per `docs/spec/12-docs-and-delivery.md` §2.)

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
