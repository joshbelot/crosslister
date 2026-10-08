# CLAUDE.md

Personal, single-user, local-only crosslisting app (Vendoo alternative) for a Mac.

**Current milestone:** M13 (M12 done — see `git log`; spec in `docs/spec/README.md`).

## Read first
1. `docs/spec/README.md` — rules + milestone list (M1…M39). Work strictly in order.
2. The spec file(s) named by the current milestone.
3. `docs/MARKETPLACE_RESEARCH.md` and `docs/ARCHITECTURE.md` for the reasons behind decisions.

## Non-negotiables
- Follow the spec literally (names of files, routes, tables, types, UI labels). When it is silent, pick the simplest option and log it in `IMPLEMENTATION_SUMMARY.md` → "Decisions made during implementation".
- After each milestone: `npm run typecheck && npm test` (and `npm run test:browser` once browser tests exist) must pass; commit as `M<n>: <title>`; update the "Current milestone" line above.
- Never add CAPTCHA solving, stealth/fingerprint plugins, automation-hiding flags, credential autofill, or proxy rotation. Logins and verification are always done by the user in the visible browser window.
- Never commit `data/`, `browser-profiles/`, `logs/`, `.env`, screenshots or tokens.
- You cannot access the real marketplaces or accounts. Build browser adapters against `fixtures/marketplace-pages/` and document them as "assisted, uncalibrated".
- No over-engineering: no auth, no multi-user, no Docker, no extra services, no event bus, no monorepo tooling.

## Commands
- `npm run dev` — server (127.0.0.1:4317) + Vite (localhost:5173)
- `npm test` / `npm run test:browser` / `npm run typecheck`
- `npm run db:generate` — after changing `src/server/db/schema.ts`
- `npm run calibrate -- <marketplace>` — selector check against the live site (user's Mac only)
