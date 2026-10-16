# Crosslister

A free, self-hosted crosslisting app for one person: create a listing once (photos, title, price, condition, brand, category, size), then publish it to Mercari, Poshmark, Depop, Facebook Marketplace, eBay, Grailed and more. It runs on your own Mac — no cloud, no subscription, and your inventory lives in a local database you can export at any time.

**How each marketplace works**

- **eBay** uses eBay's official API.
- **Mercari, Poshmark, Depop, Facebook Marketplace and Grailed** are *assisted*: the app opens the marketplace as a tab in its own Google Chrome window (you log in there once per marketplace and stay logged in), fills in the listing, and **you click Publish**.
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

Open **Settings → Marketplaces** and click **Connect** next to a marketplace. Crosslister's own Google Chrome window opens a tab at the marketplace; log in yourself (including any verification codes). The window keeps the session so you only do this once. eBay needs a one-time developer setup — see [docs/SETUP.md](docs/SETUP.md).

## Cross-list

After you confirm, the **Activity** panel shows progress per marketplace. When the app needs you — to log in, finish a field it couldn't fill, or click Publish — a yellow **needs your attention** card appears with instructions and copy buttons. If a job fails, the card says why and offers **Retry**, **Open marketplace**, and **Mark as listed**. A failed job never marks your item as listed.

## Import existing listings

Use the **Import** page to bring in what you already have:

- **eBay** — reads your active listings through eBay's API.
- **Mercari, Poshmark, Depop, Grailed** — scans your shop page in the browser window (you may be asked to open your listings page), or reads pasted listing URLs.
- **Facebook, Vinted, OfferUp, Etsy, other sites** — paste listing URLs; the app reads the page's structured data (title, price, photos, …).
- **Backup** — restore from a Crosslister backup (ZIP or JSON).

Nothing is added until you review it. Each item shows the photos and the fields the app found (fix anything wrong), and possible duplicates of items you already have — you choose **Import as new**, **Merge into this item** or **Skip**. The app never merges on its own.

## Mark sold and remove elsewhere

On an item's page, **Mark Sold** records the sale and offers to remove the item from the other marketplaces; each removal shows up in Activity. **Deactivate Everywhere** removes it without marking it sold.

## Change a price

On an item's page, **Change price** lets you type a new price or take 5–20% off. A table shows every marketplace where it is live, what it has now and what it will have; tick the ones to update. Crosslister changes only the price there (as an update job in Activity). Marketplaces where the app can't change it (the manual ones) show an **Open** link instead.

## Sold page

**Sold** in the top bar lists every sale: date, item, platform, sale price, shipping the buyer paid, fees, your label cost, item cost and net, plus buyer and where the sale came from. Filter by period, platform or text, edit any sale, or **Export CSV**. **Mark Sold** has a "More sale details" section for fees, shipping and buyer.

## Automatic sale detection

While Crosslister is running it looks at your live Mercari, Poshmark, Depop and Grailed listings in a background tab (every 60 minutes by default, at most 20 listings per marketplace per round, a few seconds apart), and eBay through its API. A browser page that looks sold is checked a second time a minute later before anything happens. When an item has sold, the sale is recorded on the Sold page and the item is removed from your other marketplaces; where you click the final button yourself you get a card in Activity to confirm. Change this in **Settings → Sales**, or turn it off and use **Inventory → ⋯ → Check listing statuses** and the banner instead.

## Optional: AI suggestions

Turn on AI in **Settings → AI** (a local model through Ollama is free; see [docs/SETUP.md](docs/SETUP.md)). Then ✨ **Suggest** buttons appear next to Title and Description, under the photos, and in **Customize per marketplace**. Suggestions are only shown for review; nothing is applied until you click **Use**.

## Back up your data

**Settings → Backup & Export** creates a full ZIP backup (database plus original photos), and exports JSON or CSV. Your data lives in three folders next to the app:

- `data/` — the database, photos, backups
- `browser-profiles/chrome/` — the Chrome profile Crosslister uses, including your marketplace logins (never included in backups)
- `logs/` — daily log files (also on the **Logs** page)

## More

- [docs/SETUP.md](docs/SETUP.md) — setup, eBay connection, AI, calibration
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — when something goes wrong
- [docs/TRACES.md](docs/TRACES.md) — job traces: find out why a field wasn't filled
- [docs/MARKETPLACE_ADAPTERS.md](docs/MARKETPLACE_ADAPTERS.md) — how each marketplace is handled and how to fix selectors
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/MARKETPLACE_RESEARCH.md](docs/MARKETPLACE_RESEARCH.md), [docs/spec/README.md](docs/spec/README.md) — design and the build spec
