# Implementation Summary

(Work in progress — completed in M39 per `docs/spec/12-docs-and-delivery.md` §2.)

## Decisions made during implementation

- **Test-only env vars (M4):** `CROSSLISTER_LOGS_DIR` overrides the logs directory and `CROSSLISTER_QUIET=1` silences console log output, so tests never write into the repo's `logs/` folder or spam output. Not documented for users.
- **Fastify 4xx errors (M4):** framework-level 4xx errors (e.g. malformed JSON body) are returned as `400 { error: { code: 'BAD_REQUEST' } }` instead of the spec's blanket 500.
- **Dependency majors (M1):** installed versions are newer than the spec assumed (zod 4, nanoid 6, vitest 5, better-sqlite3 13, sharp 0.35, vite 8). The specified behavior is kept; call signatures were adapted where needed.
- **needsAttention vs. hand-resolved failures (M6):** a most-recent `FAILED` publish job no longer flags the listing once its marketplace listing is `active` (e.g. the user used "Mark as listed"); likewise a failed deactivate once the target is `ended`. Otherwise the flag could never clear.
