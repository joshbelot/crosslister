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

### Depop (assisted, uncalibrated)

- **Automated:** photos (max 8), description, category (menu path, or typing the leaf if the control is a search box), brand, condition, size, up to 2 colors, price, parcel size from the package weight.
- **How the title works:** Depop has no title field, so the app writes the title as the first line of the description, then your description, then hashtags (your tags, or the Hashtags field under Customize per marketplace).
- **You do:** log in, review, click **Post**.
- **Deactivate:** opens the product's edit page and deletes it (Depop has no "deactivate"); if the button isn't found, you're asked to remove it yourself.
- **Known limits:** the 1,000-character description limit includes the title and hashtags; parcel-size tiers are estimates; Depop's partner API (if granted) would be a better long-term route.
- **Calibration:** not yet calibrated against the live site. Selectors: `src/server/marketplaces/depop/selectors.ts`.

### Grailed (assisted, uncalibrated)

- **Automated:** photos (max 8), category path (menswear fully; womenswear down to the category), designer, size, item name (60 chars), color, condition, description (1,000), price (whole dollars).
- **You do:** log in, review, click **Publish**. For womenswear the app asks you to choose the subcategory.
- **Deactivate:** opens the listing's edit page and deletes it; falls back to asking you.
- **Known limits:** Grailed only accepts menswear and womenswear (other departments are blocked in validation); requires brand, size and description.
- **Calibration:** not yet calibrated against the live site. Selectors: `src/server/marketplaces/grailed/selectors.ts`.

### Facebook Marketplace (assisted, uncalibrated)

- **Automated:** photos (max 10), title (100), price (whole dollars), category (types search terms such as "Men's Clothing" and picks the match), condition, description, brand and size when the form shows them, "Hide from friends" if you turn it on, then **Next**.
- **You do:** log in and click **Publish** — always. The app never clicks Publish or Delete on Facebook, and Facebook has a low daily limit (Settings → Marketplaces).
- **Finding your listing:** if Facebook doesn't land on the new listing's page, the app looks at "Your listings" and matches by title; otherwise paste the link.
- **Known limits:** no status checks; new accounts and frequent posting may be limited by Facebook.
- **Calibration:** not yet calibrated against the live site. Selectors: `src/server/marketplaces/facebook/selectors.ts`.

### eBay (official API — untested against a real account)

- **Automated:** photos are uploaded to eBay, the listing is verified (fees estimated), then added; item specifics are filled from your listing and eBay's allowed values; category is suggested automatically (change it under Customize per marketplace → eBay category); condition is chosen from the categories' allowed conditions (override under eBay condition). Updates revise title, description and price only. Ending a listing uses "NotAvailable"; "already ended" counts as success.
- **You do:** one-time developer setup ([SETUP.md](SETUP.md)), pick business policies, and confirm "Publish now" if you turned autoSubmit off.
- **Known limits:** fixed-price listings only (Good 'Til Cancelled); US marketplace; requires the three business policies and a ZIP code.
- **Verification:** all HTTP is mocked in the test suite (the listing/verify/add flow, token refresh, OAuth callback). It has **not** been run against eBay production or sandbox because no keys were available.

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
