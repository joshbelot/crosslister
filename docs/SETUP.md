# Setup

## Prerequisites

- macOS (Linux works for development, but HEIC photo conversion and the Keychain need a Mac)
- Node.js 22 or newer — check with `node -v`
- Google Chrome (required for the browser marketplaces). Crosslister starts it with its own profile; your everyday Chrome profile is not touched.

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
| `browser-profiles/chrome/` | the Chrome profile Crosslister uses (all marketplace logins) |
| `logs/` | daily log files |

Folders named `browser-profiles/mercari`, `poshmark`, … are left over from older versions and can be deleted.

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

Settings → Marketplaces → **Connect**. Crosslister opens its own Google Chrome window (separate from your everyday Chrome) with one tab per marketplace. Log in yourself, including two-factor codes — the app never sees your password. You only need to do this once per marketplace: the window can stay open, and the login is remembered even if you close it or restart the app. If the app doesn't notice that you are logged in, click **I'm logged in** on the card.

## The Chrome window

- Closing a marketplace tab while a job is running stops that job.
- Quitting that Chrome window is fine — the app reopens it when needed.
- The window listens on local port 9333 for the app (`CROSSLISTER_CDP_PORT` changes it) — only programs on your own Mac can reach it.

## Optional: AI suggestions with Ollama

```bash
brew install ollama
ollama pull gemma3:4b
```

Then enable AI in **Settings → AI** and press **Test connection**. Suggestions are never applied without your review.

Other providers: an *OpenAI-compatible server* such as LM Studio (set the server address; put `OPENAI_COMPATIBLE_API_KEY` in `.env` only if it needs one), or *Anthropic* (a paid API — set `ANTHROPIC_API_KEY` in `.env` and type the model name from Anthropic's documentation).

## Calibrating marketplaces

The browser adapters were written without access to the live sites, so their selectors may need adjusting on your Mac. See [MARKETPLACE_ADAPTERS.md](MARKETPLACE_ADAPTERS.md) for `npm run calibrate -- <marketplace>`.
