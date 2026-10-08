# Marketplace Research

Research date: **2026-10-08**. Scope: US marketplaces where an individual (non-business) seller can list second-hand goods.

> **How to read this document.** Facts that come from official documentation are cited directly. Facts that only third-party sources (vendor blogs, extension listings, forums) confirm are marked **(secondary)**. Anything marked **(verify)** must be checked against the live site during adapter calibration (see `docs/spec/06-marketplace-adapters.md`). The research environment could not load several marketplace sites directly (egress-blocked), so UI details such as field limits and category trees are **best current knowledge and must be calibrated**.

---

## 1. Summary table

| Marketplace | Official API usable by an individual? | Browser automation | Import | Publish | Delist | Major limitations |
|---|---|---|---|---|---|---|
| **Mercari (US)** | **No.** No public US seller API exists; the US web app uses browser-session-gated private endpoints (secondary). | Feasible: a standard web sell form (photos, title, description, category, brand, condition, size, shipping, price). | Browser-assisted from your own listing pages / pasted URLs. No official CSV export found. | Assisted (app fills, user or app clicks List). | Assisted (edit page → delete/deactivate). | ToS "Prohibited Conduct" + "questionable account activity" restrictions; listing-velocity blocks reported (secondary); shipping requires package weight; selectors change. |
| **Poshmark** | **No.** No public seller API. | Feasible: web form at `/create-listing`. | Browser-assisted from your closet page (public pages) / pasted URLs. No official export. | Assisted. | Assisted. | **Highest policy risk:** ToS reportedly prohibits "any robot, spider, scraper or automated means" (secondary, ToS last updated 2025-06-03). **Original price is required.** Linked-account restrictions. |
| **Depop** | **Partner-only.** The Depop Selling API is private and "not available to the general public"; integrators apply by contacting Depop. Features: API-key auth, create/update/delete items, orders, webhooks, sandbox. | Feasible: web form at `/products/create`. | Browser-assisted. Sales history CSV ("Download sales", desktop, 3-month windows) covers *sales only*, not active listings (secondary). | Assisted. | Assisted. | No title field (description-first, first line acts as title); hashtags limit; ToS restricts scraping. |
| **Facebook Marketplace** | **No** for personal sellers. Meta's Marketplace Partnerships / Commerce APIs target approved businesses and shops, not personal profiles. | Feasible but **highest friction**: dynamic React UI, ARIA comboboxes, frequent redesigns, checkpoints. | Pasted URL / manual only (weak). | Assisted, **user clicks Publish** (recommended). | Assisted. | New-account probation & listing caps (secondary, ~50/day cited); restrictions hit the whole personal account; the listing ID is not shown after publish (must be found in "Your listings"); location/local-pickup semantics. |
| **eBay** | **Yes.** Free eBay Developers Program. Inventory API (recommended for new integrations) and Trading API (XML). OAuth user consent. Default limits are designed for individuals (e.g. Inventory API 2M calls/day). | Not needed. | **API** (`GetMyeBaySelling` + `GetItem`), plus Seller Hub "All active listings" CSV report. | **API, fully automatic.** | **API** (`EndFixedPriceItem`). | Developer account + keyset; must comply with Marketplace Account Deletion notifications (subscribe or request exemption); business policies; required item specifics per category; Inventory-API listings cannot be managed by Trading-API/legacy tools afterwards (secondary). |
| **Grailed** | **No.** No public API (third-party scrapers use its Algolia search backend). | Feasible: web form at `/sell/new`. | Browser-assisted. | Assisted. | Assisted. | Designer (brand) is required; menswear/womenswear focus; ToS not verified (verify). |
| **OfferUp** | **No.** | Poor: app-first; whether the website allows posting is contradictory across sources (verify). OfferUp blocks non-US/datacenter traffic (secondary). | Manual. | **Manual-assist only** (copy panel + open site). | Manual. | Local-pickup marketplace; mobile-first. |
| **Vinted (US)** | **Restricted.** Vinted Pro Integrations is for *selected Pro (business) sellers* with 4–6 week onboarding. Not available to individuals. | Possible, not prioritized. | Manual / pasted URL. | **Manual-assist.** | Manual. | US catalog separate from EU; zero seller fees (secondary). |
| **Etsy** | **Yes** (Open API v3, OAuth, `listings_w` scope, ~10k req/day secondary). | n/a | API possible. | API possible. | API possible. | **Only handmade, vintage (20+ years), or craft supplies** may be sold — not a general resale channel. **Manual-assist in V1**, API later only if the user sells vintage. |

---

## 2. Per-marketplace detail

### 2.1 Mercari (US)

**A. Official API.** None for US sellers. Search returned only third-party read-only scrapers; they note that the "US web API is session-auth-gated" and that the web app relies on "browser-minted session state" (secondary: Apify actor docs). Mercari Japan has a separate public search endpoint; irrelevant to US selling. No create/edit/delete/status API, no rate-limit documentation, nothing free to sign up for.

**B. Browser automation.** Feasible. Sell form: `https://www.mercari.com/sell/` (verify). Item URLs look like `https://www.mercari.com/us/item/m12345678901/` (verify) — the remote ID is the `m…` token. Fields: photos (up to 12, verify), title (≤80 chars, verify), description (≤1000, verify), category (3 levels), brand (typeahead), condition (New / Like new / Good / Fair / Poor), color, size (category-dependent), shipping (Mercari label by package weight, or ship on your own), price (min $1, verify). Photo upload via `<input type="file">` works with Playwright `setInputFiles`. Edit / delete is via the item's edit page (verify exact flow).

**C. Anti-bot.** Account restrictions for "questionable account activity or high-risk behavior" are documented on Mercari's help center; cross-listing vendors report temporary listing blocks after "listing too many items within a time period or listing too quickly" (secondary). Expect login challenges (email/SMS code) on new devices. The app must pause for the user — never automate around these.

**D. Import.** No official listing export found. Third-party extensions scrape listings (secondary). Our approach: browser-assisted extraction from the user's own item pages (JSON-LD/OpenGraph first), at human pace.

### 2.2 Poshmark

**A. Official API.** None. All integrations found (Closo, Crosslist, ClosetWitch) work through the user's browser session via an extension (secondary).

**B. Browser automation.** Feasible. Form: `https://poshmark.com/create-listing` (verify). Item URLs: `https://poshmark.com/listing/<slug>-<24-hex-id>` (verify). Fields: photos (cover + up to 16 total, verify), title (≤80, verify), description (≤1500, verify), category (department › category › subcategory), size (required for most apparel), brand (typeahead), condition (verify current options; Poshmark distinguishes NWT), colors (up to 2), style tags (up to 3), **original price (required)**, listing price (min $3, verify). Shipping is Poshmark's flat label.

**C. Anti-bot / policy.** A closet-management vendor quotes the 2025-06-03 Terms as banning "any robot, spider, scraper or automated means to access the platform" and reserving the right to suspend accounts (secondary). Linked-closet restrictions are reported (secondary). **This is the marketplace with the clearest ToS risk.** Mitigation in our design: human-in-the-loop, the user presses the final button by default, no sharing bots, no bulk actions, low daily caps. The user accepts residual risk; the app documents it.

**D. Import.** No official export (secondary). Closet pages are public, so browser-assisted extraction of the user's own closet is feasible.

### 2.3 Depop

**A. Official API.** The **Depop Selling API** exists but is "currently private and is not available to the general public"; interested integrators contact Depop and Depop decides. Features: API-key authentication, inventory management (create/update/delete items), order management, webhooks, offers, sandbox. Changelog shows active development in 2026 (e.g. pricing-inspiration endpoint, May 2026). Vendoo has migrated to this API (Vendoo blog). **Not realistically available to a single personal user** — you may apply, but don't plan on it. The adapter architecture allows swapping the browser adapter for an API adapter later.

**B. Browser automation.** Feasible. Form: `https://www.depop.com/products/create/` (verify). Item URLs: `https://www.depop.com/products/<username>-<slug>/` (verify); the slug is the remote ID. No separate title — the description is primary (≤1000 chars, verify), hashtags (≤5, verify). Category, brand, condition (Brand new / Like new / Used – Excellent / Used – Good / Used – Fair, verify), size, colors (≤2), price, shipping (Depop label by package size, or own).

**C. Anti-bot.** Login via email code is common. Treat as pause-for-user.

**D. Import.** "Download sales" CSV on desktop web, 3-month windows (secondary) — sales only. Listings: browser-assisted from the user's shop page.

### 2.4 Facebook Marketplace

**A. Official API.** No API for personal sellers. Meta's Marketplace Partnerships program and Commerce Platform APIs are for eligible business partners/shops; Meta Content Library is research-only (academic/non-profit). A 2007 Marketplace API is long gone.

**B. Browser automation.** Feasible but fragile. Form: `https://www.facebook.com/marketplace/create/item` (verify). Fields: photos (up to 10, verify), title, price, category (searchable combobox), condition (New / Used – Like New / Used – Good / Used – Fair), description, product tags, location (from profile), delivery method (local pickup / shipping — shipping not available to new accounts per Vendoo help center), "Hide from friends". Two-step "Next" → "Publish". After publishing, Facebook does not navigate to the item page; the ID must be read from "Your listings" (`/marketplace/you/selling`, verify). Item URLs: `https://www.facebook.com/marketplace/item/<digits>/`.

**C. Anti-bot.** Highest. Checkpoints, new-account probation ("listing maximum", no shipping), restrictions that affect the whole personal account, sudden bursts of listings trigger temporary limits (secondary). **Design:** the app fills, the user always presses Publish (autoSubmit forbidden for Facebook in V1), daily cap default 10.

**D. Import.** Weak. Pasted URL with OpenGraph fallback; otherwise manual.

### 2.5 eBay

**A. Official API.** Yes, and free to join (eBay Developers Program). After joining and creating a keyset, "you can start using eBay APIs immediately". Default call limits "are designed for individuals and smaller businesses" (Inventory API: 2,000,000 calls/day; Media API: 50 POSTs per 5 s per user). eBay "recommends using Inventory API" for new integrations; Inventory-API publishing requires the seller to be opted in to **business policies** (payment, fulfillment, return). The Trading API (`AddFixedPriceItem`, `ReviseFixedPriceItem`, `EndFixedPriceItem`, `GetItem`, `GetMyeBaySelling`, `UploadSiteHostedPictures`) remains available and accepts OAuth tokens. **Compliance requirement:** every developer must subscribe to Marketplace Account Deletion notifications **or** apply for an exemption if the app does not persist eBay user data; production keysets are disabled until one is done.

**Decision for this app: use the Trading API for listing CRUD.** Reasons: (1) a personal seller also edits listings on ebay.com and in the eBay app; vendors report that listings created/migrated via the Inventory API can no longer be managed by Trading-based tools and that UI edits may not be reflected in Inventory-API reads (secondary); Trading-API listings remain ordinary eBay listings. (2) One API family for create, revise, end, status and import (`GetMyeBaySelling`). (3) No inventory-location/offer object model to maintain. REST APIs are still used for **Taxonomy** (category suggestions, required aspects), **Metadata** (valid condition IDs per category), and **Account** (list the user's business policies).

**B/C.** Browser automation unnecessary. OAuth consent is a normal eBay sign-in in the user's browser.

**D. Import.** `GetMyeBaySelling` (ActiveList, paginated) + `GetItem` (details, pictures, item specifics). Seller Hub → Reports → Downloads → "All active listings" CSV also exists (no descriptions).

### 2.6 Grailed

**A.** No official API (third-party scrapers: "there's no Grailed API"; they read the Algolia search index). **B.** Web sell form at `https://www.grailed.com/sell/new` (verify): department (menswear/womenswear), category, subcategory, **designer (required, typeahead)**, size, item name, color, condition, description, price, shipping, photos. Item URLs: `https://www.grailed.com/listings/<digits>-<slug>`. **C.** Standard login; treat challenges as pause-for-user. ToS not verified — assume automated access is restricted like peers (StockX, Highsnobiety prohibit bots). **D.** Browser-assisted from own listings.

### 2.7 OfferUp

No official API (third-party scrapers state this). App-first, local-pickup marketplace. Website posting is contradictory across sources — verify. OfferUp blocks non-US and datacenter traffic (secondary). **V1: manual-assist adapter** (opens site, copy-panel, photo folder, user pastes resulting URL).

### 2.8 Vinted (US)

Operating in the US since 2024 with a separate US catalog (secondary). Official API = **Vinted Pro Integrations**, open only to selected Pro sellers (designer/luxury focus, 4–6 week setup). **V1: manual-assist adapter.**

### 2.9 Etsy

Official Open API v3: `POST /v3/application/shops/{shop_id}/listings` with OAuth + `x-api-key`, scopes `listings_r`/`listings_w`; required fields include quantity, price, who_made, when_made, is_supply, taxonomy_id. Personal vs commercial access levels exist. **Etsy only permits handmade, vintage (20+ years) and craft supplies** → not a general resale channel. **V1: manual-assist adapter**; an API adapter is a future option.

### 2.10 Others considered

- **Kidizen, Curtsy, Whatnot, ThredUp, The RealReal, Tradesy (closed 2022)**: niche, consignment or live-selling. Not in scope; the generic manual-assist adapter covers "Other".
- **Shopify / Square Online**: storefronts, not marketplaces; out of scope.

---

## 3. Conclusions

1. **Realistically automatable:** eBay (fully, via official API). Mercari, Poshmark, Depop, Grailed, Facebook can be *assisted* by browser automation (fill everything, pause for user).
2. **Official APIs usable by an individual:** eBay (yes), Etsy (yes, but category-restricted). Depop and Vinted have APIs only for approved partners/Pro sellers. Mercari, Poshmark, Facebook, Grailed, OfferUp: none.
3. **Require browser automation:** Mercari, Poshmark, Depop, Facebook, Grailed.
4. **Require manual intervention:** first login + any 2FA/CAPTCHA/checkpoint on every browser marketplace; Facebook Publish click (always); final Publish click on all browser marketplaces *by default* (configurable per marketplace except Facebook); OfferUp, Vinted, Etsy, Other are manual-assist.
5. **Importable:** eBay via API. Mercari, Poshmark, Depop, Grailed via browser-assisted extraction of the user's own listings. Facebook via pasted URL (best effort). Everything via the generic "paste a URL" importer or the JSON backup format.
6. **Priority:** (1) Core app + manual-assist adapter (useful on day one for every marketplace). (2) Mercari — first browser adapter, builds the shared automation engine. (3) Poshmark, (4) Depop, (5) **eBay (moved ahead of Facebook: highest reliability, fully automatic)**, (6) Facebook, (7) Grailed. Import: eBay first (easiest), then URL importer, then shop-page importers.
7. **Limitations:** no public APIs for the four core marketplaces → selectors break when sites change (mitigated by accessible-name locators, calibration tooling, and graceful degradation to "needs your attention" instead of failure); ToS risk on Poshmark/Mercari/Facebook (mitigated by human-in-the-loop and low volume, not eliminated); category trees and field limits must be calibrated on the user's Mac with a real account; eBay requires a developer account and one-time setup.
8. **Recommended V1 scope:** local app (inventory, fast create/edit, photos, validation, export/backup), manual-assist for all marketplaces, assisted browser adapters for Mercari, Poshmark, Depop, Facebook, Grailed, API adapter for eBay, manual mark-sold + deactivate-elsewhere. Import, status polling and AI follow in later phases.

### Policy stance (applies to every adapter)

- Never bypass or solve CAPTCHAs, never use stealth/fingerprint-spoofing plugins, never automate login credentials, never rotate IPs or accounts.
- Use a normal, visible browser window with a persistent profile per marketplace; the user logs in themselves.
- Default to the user pressing the final Publish/Delete button. Self-imposed daily caps. No closet-sharing/follow/offer bots.
- Only the user's own account and own listings are accessed.
- Automating your own account may still violate a marketplace's terms. This is the user's informed choice; the README must state it plainly.

---

## 4. Sources

Official:
- Depop Partner API docs: https://partnerapi.depop.com/api-docs/ and changelog https://partnerapi.depop.com/api-docs/changelog/
- eBay API call limits: https://developer.ebay.com/develop/get-started/api-call-limits , https://developer.ebay.com/develop/api/sell/api_call_limits
- eBay Inventory API overview: https://developer.ebay.com/api-docs/sell/inventory/static/overview.html
- eBay publishing offers / business policies: https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html , https://www.developer.ebay.com/api-docs/sell/static/seller-accounts/business-policies.html
- eBay listing creation guide (Inventory vs Trading): https://developer.ebay.com/develop/guides-v2/listing-creation/listing-creation
- eBay AddFixedPriceItem: https://developer.ebay.com/DevZone/XML/docs/reference/ebay/AddFixedPriceItem.html
- eBay bulkMigrateListing: https://developer.ebay.com/api-docs/sell/inventory/resources/listing/methods/bulkMigrateListing
- eBay Marketplace Account Deletion: https://www.developer.ebay.com/marketplace-account-deletion , https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion
- eBay Analytics getRateLimits: https://developer.ebay.com/api-docs/developer/analytics/resources/rate_limit/methods/getRateLimits
- Meta Marketplace Partnerships: https://developers.secure.facebook.com/docs/marketplace/partnerships/
- Meta Marketplace approval API (shops): https://developers.secure.facebook.com/docs/commerce-platform/platforms/distribution/MPApprovalAPI
- Mercari Terms of Service: https://www.mercari.com/us/help_center/topics/account/policies/terms-of-service/
- Mercari prohibited items: https://www.mercari.com/prohibited_items/
- Vinted Pro integrations: https://vinted.co.uk/pro/integrations
- Etsy listings tutorial: https://developer.etsy.com/documentation/tutorials/listings

Secondary (vendor blogs, extension listings, forums — used only where no official source exists):
- Vendoo Depop API integration: https://blog.vendoo.co/new-depop-api-integration
- Vendoo "I cannot list on Mercari": https://help.vendoo.co/en/articles/6812636-i-cannot-list-on-mercari
- Vendoo "I can't list on Facebook Marketplace": https://help.vendoo.co/en/articles/6817366-i-can-t-list-on-facebook-marketplace
- Vendoo on Poshmark bots: https://blog.vendoo.co/poshmark-bots-what-you-need-to-know-about-using-bots
- Closo marketplaces & Poshmark automation: https://closo.co/pages/marketplaces , https://closo.co/blogs/crosslisting/is-posher-va-worth-it-the-truth-about-poshmark-automation-in-2026
- Linked Poshmark closets: https://blog.send.win/multiple-poshmark-closets-banned-fix-linking-fast/?amp=1
- Facebook Marketplace listing tools (50/day claim): https://ofzenandcomputing.com/6-best-facebook-marketplace-listing-tools-cy-tested-reviewed/
- Mercari scrapers (session-gated web API): https://apify.com/kitebuilds/resale-sold-comps , https://apify.com/quine/mercari-scraper.md
- Grailed (no API, Algolia): https://www.scrapingbee.com/scrapers/grailed-api/ , https://apify.com/bovi/grailed-listings
- OfferUp (no API, blocks datacenter): https://apify.com/parseforge/offerup-scraper , https://apify.com/haketa/offerup-scraper
- Vinted USA: https://margeoapp.com/en/blog/is-vinted-available-in-the-usa/
- Depop sales export: https://idshipthat.app/how-to/depop/export-sales-csv/
- eBay Seller Hub active listings report: https://community.ebay.com/t5/Seller-Tools/how-to-create-a-csv-file-of-my-listings-and-feedback/m-p/34678100
- Inventory-API listings not manageable by Trading tools: https://selleractive.com/support/ebay-error-inventoryapi-based-listing-management-not-supported , https://help.sumtracker.com/ebay-inventory-not-syncing-due-to-migration-of-listings-to-ebay-inventory-api
- GetMyeBaySelling discussion: https://community.ebay.com/t5/RESTful-Sell-APIs-Account/Get-a-list-of-active-seller-items/td-p/33664670
