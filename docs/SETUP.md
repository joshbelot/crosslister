# Setup

## Prerequisites

- macOS (Linux works for development, but HEIC photo conversion and the Keychain need a Mac)
- Node.js 22 or newer — check with `node -v`
- Google Chrome (recommended). Without it, run `npx playwright install chromium` once and choose **Playwright Chromium** under Settings → General → Browser.

## Install and first run

```bash
git clone https://github.com/joshbelot/crosslister.git
cd crosslister
npm install
npm run dev
```

Open <http://localhost:5173>. The first start creates `data/`, `browser-profiles/` and `logs/` next to the app.

## Where data is stored

| Folder | Contents |
|---|---|
| `data/crosslister.db` | your inventory (SQLite) |
| `data/listings/<id>/original/` | your original photos, never modified |
| `data/backups/` | ZIP backups |
| `browser-profiles/<marketplace>/` | the saved browser login for each marketplace |
| `logs/` | daily log files |

To store them elsewhere, copy `.env.example` to `.env` and set `CROSSLISTER_DATA_DIR` and `CROSSLISTER_PROFILES_DIR`, then restart.

## Connect eBay

eBay is the one marketplace that uses an official API, so it needs a one-time developer setup.

1. Create an account at <https://developer.ebay.com>.
2. Create an application keyset (**Production**).
3. Complete **Marketplace account deletion**: choose **opt out / exempt** with the reason "Personal single-user tool; the only eBay account used is my own". (If eBay insists on a notification endpoint, Crosslister does not provide a public endpoint — contact eBay developer support.)
4. Open **User Tokens → Get a Token from eBay via Your Application** and create a **RuName**. Set its "auth accepted URL" to `http://localhost:4317/api/marketplaces/ebay/oauth/callback` if eBay accepts it; otherwise use any HTTPS page — you will paste the address you land on back into the app.
5. Copy the **App ID (Client ID)**, **Cert ID (Client Secret)** and **RuName** into `.env`:

   ```dotenv
   EBAY_ENV=production
   EBAY_CLIENT_ID=...
   EBAY_CLIENT_SECRET=...
   EBAY_RUNAME=...
   ```

6. Restart the app, open **Settings → eBay** and click **Connect**.
7. In eBay **Seller Hub → Account → Business policies**, create a shipping, payment and return policy first, then pick them under Settings → eBay and enter your ZIP code.

## Connect the browser marketplaces

Settings → Marketplaces → **Connect**. A normal browser window opens at the marketplace's login page. Log in yourself, including two-factor codes — the app never sees your password. The window stays open while a job needs it and closes itself after a few idle minutes; your login is kept in `browser-profiles/<marketplace>/`. **Disconnect** deletes that saved session.

## Optional: AI suggestions with Ollama

```bash
brew install ollama
ollama pull gemma3:4b
```

Then enable AI in **Settings → AI** and press **Test connection**. Suggestions are never applied without your review.

Other providers: an *OpenAI-compatible server* such as LM Studio (set the server address; put `OPENAI_COMPATIBLE_API_KEY` in `.env` only if it needs one), or *Anthropic* (a paid API — set `ANTHROPIC_API_KEY` in `.env` and type the model name from Anthropic's documentation).

## Calibrating marketplaces

The browser adapters were written without access to the live sites, so their selectors may need adjusting on your Mac. See [MARKETPLACE_ADAPTERS.md](MARKETPLACE_ADAPTERS.md) for `npm run calibrate -- <marketplace>`.
