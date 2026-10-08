# 12 — Documentation and Delivery (M17, M39)

## 1. Documents to write

Write for a non-programmer Mac user who is comfortable copying commands into Terminal.

### `README.md` (replace the current one)
1. What Crosslister is (2–3 sentences) and the honest status line: "eBay uses eBay's official API. Mercari, Poshmark, Depop, Facebook and Grailed are *assisted*: the app opens the marketplace in a browser window, fills in the listing, and you click Publish. Vinted, OfferUp and Etsy are manual-assist."
2. **Important**: marketplace terms. "Some marketplaces (notably Poshmark) restrict automated tools in their terms. Crosslister only works in a visible browser window on your own account, never solves CAPTCHAs or hides that it is automated, and by default leaves the final click to you. You are responsible for following each marketplace's rules."
3. Install (Node 22+ via https://nodejs.org or Homebrew `brew install node`; `git clone`; `npm install`; `npx playwright install chromium` (only needed if you don't use Google Chrome)).
4. Start: `npm run dev` → open http://localhost:5173. Production-style: `npm run build && npm start` → http://localhost:4317.
5. Create a listing (the 60-second flow: New Listing → drop photos → title/price/condition/brand/category/size → choose marketplaces → Cross-List).
6. Connect marketplaces (Settings → Marketplaces → Connect → log in in the window that opens; eBay: see SETUP.md).
7. Cross-list (validation screen, Activity panel, "needs your attention" cards, what to do when something fails).
8. Import listings (Import page; methods per marketplace).
9. Mark sold & remove elsewhere.
10. Backup data (Settings → Backup & Export; what's in a backup; where data lives: `data/`, `browser-profiles/`, `logs/`).
11. Links to docs.

### `docs/SETUP.md`
- Prerequisites, install, first run, where data is stored, how to change folders (`.env`).
- **Connect eBay** step by step: create an account at developer.ebay.com → create an application keyset (Production) → complete "Marketplace account deletion": choose **opt out/exempt** with the reason "Personal single-user tool; the only eBay account used is my own" (and note: if eBay requires the notification endpoint instead, Crosslister doesn't provide a public endpoint — contact eBay developer support), → User Tokens → "Get a Token from eBay via Your Application" → create a RuName; set its "auth accepted URL" to `http://localhost:4317/api/marketplaces/ebay/oauth/callback` if eBay accepts it, otherwise any HTTPS page (you'll paste the address back) → copy App ID (Client ID), Cert ID (Client Secret), RuName into `.env` → restart → Settings → eBay → Connect → choose business policies (create them in Seller Hub first) → ZIP code.
- Connect each browser marketplace (first login, 2FA, why the window stays open, where the profile lives, how to log out = Disconnect).
- Optional AI with Ollama: `brew install ollama`, `ollama pull gemma3:4b`, enable in Settings.
- Calibrating marketplaces: `npm run calibrate -- poshmark` (link to MARKETPLACE_ADAPTERS.md).

### `docs/MARKETPLACE_ADAPTERS.md`
- How adapters work (interface summary, recipe/step model, needs-user, autoSubmit).
- Per marketplace: what's automated, what you do, limits, known issues, last calibration date ("not yet calibrated" initially).
- Calibration procedure (05 §9.1) and how to fix a selector (add a candidate at the top of the spec list in `selectors.ts`, re-run calibrate, run `npm run test:browser`).
- How to fix a category mapping without code (Settings → Marketplaces → Category mapping) and per listing (Customize per marketplace).
- How to add a new marketplace (copy `manual` → browser adapter checklist 06 §8; register in `registry.ts`; add id to `MARKETPLACE_IDS`).
- Statement that fixture tests verify flow logic, not live sites.

### `docs/TROUBLESHOOTING.md`
Entries (symptom → cause → fix): app won't start (Node version, port in use `lsof -i :4317`); "Request blocked" (open via localhost:5173 not an IP); photos won't upload (size, HEIC on non-Mac); browser window doesn't open (Chrome missing → Settings → Browser → Chromium, `npx playwright install chromium`); "profile is in use" (quit other Crosslister/calibrate process); stuck on login (complete verification in window; Continue); field "couldn't fill automatically" (fill manually; calibrate later); category not selected (set Category mapping); job failed after restart (APP_RESTARTED meaning); Facebook limits; Poshmark/Mercari temporary blocks (slow down, lower daily limit); eBay errors (policies missing, invalid_grant → reconnect, item specifics required); restoring a backup; where logs are (Logs page, `logs/`); resetting a marketplace session (Disconnect).

### `docs/ARCHITECTURE.md`
Already written; update it if implementation decisions change anything.

## 2. `IMPLEMENTATION_SUMMARY.md` (M39) — template

```markdown
# Implementation Summary

## What was built
<one paragraph + bullet list of features by phase, marking each milestone M1–M38 as Done / Partial / Not started>

## How to run
npm install
npm run dev   # http://localhost:5173

## Marketplaces supported
| Marketplace | Method | Publish | Update | Deactivate | Import | Status checks | Calibrated on a real account? |
|---|---|---|---|---|---|---|---|
| eBay | Official API | Automatic | Automatic | Automatic | API | API | No (requires your keys) |
| Mercari | Assisted browser | Fill + you click List | … | … | Shop page / URLs | On demand | No |
| … |

## Marketplace limitations
<from research + anything learned during implementation>

## Files created/modified
<tree of src/, tests/, docs/, fixtures/ with one line per important file>

## Decisions made during implementation
<every place the spec was silent or a library API differed>

## Known bugs / gaps
<honest list, including "browser adapters are uncalibrated against live sites">

## Next recommended features
1. Calibrate each browser adapter on the real sites (`npm run calibrate`).
2. Apply for Depop's partner API; replace the browser adapter if granted.
3. Etsy API adapter (if selling vintage).
4. Bulk actions in inventory (multi-select cross-list / mark sold).
5. Price drop scheduling.
6. Photo background removal (local model).
```

## 3. Definition of done (whole project)

- `npm install && npm run dev` works on a clean Mac with Node 22.
- `npm run typecheck`, `npm test`, `npm run test:browser` pass.
- The success-criteria flow works end-to-end with the manual adapter for every marketplace, with the eBay sandbox when keys are provided, and against the fixture pages for every browser adapter.
- No secrets, profiles or data in git (`git ls-files` shows none of `data/`, `browser-profiles/`, `logs/`, `.env`).
- All documents in §1 and `IMPLEMENTATION_SUMMARY.md` exist and are accurate.
