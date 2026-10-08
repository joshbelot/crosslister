# Marketplace adapters

> **Status: drafted in Phase 1.** Sections for each marketplace are completed as its adapter lands. Until then every marketplace works as a *manual* adapter.

## How adapters work

Core code talks to marketplaces only through the adapter interface (`src/server/marketplaces/types.ts`) and `registry.ts`. An adapter declares its capabilities (photo limit, title/description length, required fields), validates a listing, maps canonical values (condition, category, colors) to the marketplace's own, and implements `connect`, `publish`, `deactivate` (and optionally `update`, `checkStatus`, import).

Publishing runs as a **job** made of **steps**:

- A *required* step (e.g. uploading photos) fails the job if it fails.
- An *optional* step (e.g. choosing a brand) that can't be completed becomes a **needs your attention** item instead of an error — the app asks you to finish it in the browser.
- **Needs user**: the job pauses until you log in, solve a verification, fix fields, or click Publish. The app notices when you're done, or you click Continue.
- **autoSubmit** (off by default, never allowed for Facebook): the app clicks the final Publish button itself.

## Per marketplace

| Marketplace | Method | What's automated | What you do | Calibration |
|---|---|---|---|---|
| eBay | Official API | everything | one-time developer setup | not yet calibrated |
| Mercari | Assisted browser | fills the form | log in, click **List** | not yet calibrated |
| Poshmark | Assisted browser | fills the form | log in, click **List** | not yet calibrated |
| Depop | Assisted browser | fills the form | log in, click **List** | not yet calibrated |
| Facebook Marketplace | Assisted browser | fills the form | log in, click **Publish** | not yet calibrated |
| Grailed | Assisted browser | fills the form | log in, click **Submit** | not yet calibrated |
| Vinted, OfferUp, Etsy, Other | Manual-assist | copy buttons + photo folder | create the listing, paste its link | n/a |

Limits and known issues are added here as each adapter is built.

### Mercari (assisted, uncalibrated)

- **Automated:** photo upload (max 12), title (80 chars), description (1,000 chars), category path, brand, condition, size, one color, package weight and who pays shipping, price (turns Smart Pricing off).
- **You do:** log in, review, click **List** (or enable "Click the final Publish button for me" in Settings → Marketplaces).
- **Deactivate:** opens the listing's edit page and clicks Deactivate; if it can't, it asks you to remove the listing and click "It's removed".
- **Known limits:** Mercari has no "Multicolor" option (color is left empty); "New without tags" is sent as "Like new"; only one color is chosen.
- **Calibration:** not yet calibrated against the live site. Selectors: `src/server/marketplaces/mercari/selectors.ts`.

### Poshmark (assisted, uncalibrated)

- **Automated:** photos (max 16), title (80), description (1,500), category path, size, condition, brand (free text allowed), up to 2 colors, up to 3 style tags (from the listing's tags unless set), original price (MSRP) and listing price, then **Next** to open the review page.
- **You do:** log in, review, click **List**. The app shows a one-time notice that Poshmark's terms restrict automated tools.
- **Deactivate:** sets the listing to "Not For Sale" (reversible) and clicks Update; if the Availability control is missing, it falls back to Delete listing → Yes.
- **Known limits:** whole-dollar prices only (cents are rounded, with a warning); needs MSRP and size; no categories for Collectibles & Other; no "Multicolor".
- **Calibration:** not yet calibrated against the live site. Selectors: `src/server/marketplaces/poshmark/selectors.ts`.

## Calibration

The selectors, labels and category trees in the adapters are best-effort knowledge of the live sites and were **not verified against them**. The tests use local HTML fixtures, which verify the app's flow logic and helpers — **not** accuracy against the real sites.

On your Mac, with Crosslister **not running**:

```bash
npm run calibrate -- poshmark          # opens the sell page; log in and navigate if needed
```

Press Enter to run the selector check; it prints ✓/✗ for every control the adapter uses. `pause` opens the Playwright Inspector (use *Pick locator*). To fix a failing control, add a new candidate **at the top** of that spec's list in `src/server/marketplaces/<marketplace>/selectors.ts`, re-run calibrate, then run `npm run test:browser` and commit.

## Fixing categories without code

- Everywhere: **Settings → Marketplaces → Category mapping…**
- One listing: **Customize per marketplace → Category on <marketplace>** (format `Men > Shoes > Sneakers`).

## Adding a new marketplace

1. Add the id and name to `src/shared/constants.ts` (`MARKETPLACE_IDS`, names, order) and to `DEFAULT_SETTINGS.marketplaces`.
2. Start from the manual adapter (`marketplaces/manual/index.ts`) and register it in `registry.ts`.
3. For a browser adapter, follow the checklist in `docs/spec/06-marketplace-adapters.md` §8: `index.ts`, `mapping.ts`, `selectors.ts`, fixture pages in `fixtures/marketplace-pages/<id>/`, and tests.
