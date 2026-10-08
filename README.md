# Crosslister

A free, self-hosted crosslisting app for one person: create a listing once (photos, title, price, condition, brand, category, size), then publish it to Mercari, Poshmark, Depop, Facebook Marketplace, eBay, Grailed and more. It runs on your own Mac — no cloud, no subscription, and your inventory lives in a local database you can export at any time.

**How each marketplace works**

- **eBay** uses eBay's official API.
- **Mercari, Poshmark, Depop, Facebook Marketplace and Grailed** are *assisted*: the app opens the marketplace in a browser window (where you are logged in), fills in the listing, and **you click Publish**.
- **Vinted, OfferUp, Etsy and "Other"** are *manual-assist*: one-click copy of every field, a ready photo folder, and the app records the listing link.

> **Important — marketplace terms.** Some marketplaces (notably Poshmark) restrict automated tools in their terms. Crosslister only works in a visible browser window on your own account, never solves CAPTCHAs or hides that it is automated, and by default leaves the final click to you. You are responsible for following each marketplace's rules.

## Install

You need a Mac, [Node.js 22 or newer](https://nodejs.org) (or `brew install node`) and, ideally, Google Chrome.

```bash
git clone https://github.com/joshbelot/crosslister.git
cd crosslister
npm install
npx playwright install chromium   # only needed if you don't use Google Chrome
```

## Start

```bash
npm run dev
```

Then open <http://localhost:5173>. (Production-style: `npm run build && npm start`, then open <http://localhost:4317>.) Always open the app through `localhost` — it refuses other addresses on purpose.

## Create a listing (about a minute)

1. Click **New Listing** (or press `N`).
2. Drop your photos on the page (you can also paste them or press `⌘O`). The first photo is the cover; drag to reorder, rotate, crop or delete.
3. Fill in title, price, condition, brand, category and size. Everything saves automatically.
4. Choose the marketplaces under **Cross-list to**.
5. Click **Cross-List Item** (`⌘↵`). A validation screen tells you what each marketplace still needs.

## Connect marketplaces

Open **Settings → Marketplaces** and click **Connect** next to a marketplace. A browser window opens at its login page; log in yourself (including any verification codes). The window keeps the session so you only do this once. eBay needs a one-time developer setup — see [docs/SETUP.md](docs/SETUP.md).

## Cross-list

After you confirm, the **Activity** panel shows progress per marketplace. When the app needs you — to log in, finish a field it couldn't fill, or click Publish — a yellow **needs your attention** card appears with instructions and copy buttons. If a job fails, the card says why and offers **Retry**, **Open marketplace**, and **Mark as listed**. A failed job never marks your item as listed.

## Import existing listings

Use the **Import** page to bring in what you already have: from eBay via the API, from a shop page, or from a list of listing URLs. Imported items are shown for review (with duplicate detection) before anything is added to your inventory.

## Mark sold and remove elsewhere

On an item's page, **Mark Sold** records the sale and offers to remove the item from the other marketplaces; each removal shows up in Activity. **Deactivate Everywhere** removes it without marking it sold.

## Back up your data

**Settings → Backup & Export** creates a full ZIP backup (database plus original photos), and exports JSON or CSV. Your data lives in three folders next to the app:

- `data/` — the database, photos, backups
- `browser-profiles/` — saved marketplace logins (never included in backups)
- `logs/` — daily log files (also on the **Logs** page)

## More

- [docs/SETUP.md](docs/SETUP.md) — setup, eBay connection, AI, calibration
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — when something goes wrong
- [docs/MARKETPLACE_ADAPTERS.md](docs/MARKETPLACE_ADAPTERS.md) — how each marketplace is handled and how to fix selectors
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/MARKETPLACE_RESEARCH.md](docs/MARKETPLACE_RESEARCH.md), [docs/spec/README.md](docs/spec/README.md) — design and the build spec
