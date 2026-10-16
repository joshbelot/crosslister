# Troubleshooting

Each entry is *symptom → cause → fix*.

**The app won't start.** → Wrong Node version, or the port is taken. → Run `node -v` (needs 22+). Check the port with `lsof -i :4317`; stop the other process or set `PORT` in `.env`.

**"Request blocked."** → The app only accepts requests addressed to `localhost` or `127.0.0.1`. → Open <http://localhost:5173> (dev) or <http://localhost:4317> (production), not your Mac's network address.

**Photos won't upload.** → The file is over 50 MB, is not JPG/PNG/WEBP/HEIC, the listing already has 24 photos, or it is a HEIC file on a non-Mac. → Resize or convert the photo (export HEIC as JPEG).

**The Chrome window doesn't open.** → Google Chrome is not installed, or the app could not start it. → Install Google Chrome. If it is installed in an unusual place, set `CROSSLISTER_CHROME_PATH` in `.env`. If another program uses port 9333, set `CROSSLISTER_CDP_PORT=9444`.

**"Couldn't start Google Chrome for Crosslister."** → A leftover Crosslister Chrome is half-open. → Quit that Chrome window (the one with the marketplace tabs) and try again.

**I'm logged in but the app keeps asking.** → The app's way of recognising a logged-in page is out of date for that marketplace. → Click **I'm logged in** on the card; the app remembers it. Then run `npm run calibrate -- <marketplace> home` to fix the selector.

**"<Marketplace> didn't load".** → The marketplace showed an error page (often a temporary block or rate limit). → Reload the tab in the Chrome window, or wait a few minutes; when the page looks normal click **Continue**.

**Stuck on a login page.** → The marketplace wants a verification code or security check. → Complete it in the browser window yourself, then click **Continue** on the card in Activity. The app never touches CAPTCHAs or verification widgets.

**"Couldn't fill automatically — please fill … in the browser."** → The marketplace's page differs from what the app expects. → Fill that field yourself and continue. To fix it for good, calibrate the marketplace ([MARKETPLACE_ADAPTERS.md](MARKETPLACE_ADAPTERS.md)).

**The category wasn't selected.** → No mapping exists for that category on this marketplace. → Settings → Marketplaces → **Category mapping…**, or set it for one listing under **Customize per marketplace**.

**A job says "The app was restarted while this was running."** → You quit or restarted Crosslister during a job. → Check the marketplace to see whether the listing went through, then **Retry** or use **Mark as listed**.

**Facebook Marketplace limits.** → Facebook is strict about automation. → Facebook is always fill-only (you click Publish), with a low daily limit (Settings → Marketplaces). Keep volumes small.

**Poshmark or Mercari block or slow me down.** → Too many actions in a short time. → Lower the daily limit in Settings → Marketplaces and spread listings across the day.

**eBay errors.** → "Policies missing": create business policies in Seller Hub and select them in Settings → eBay. `invalid_grant`: your eBay connection expired — **Connect** again. "Item specifics required": fill the required aspects under **Customize per marketplace → eBay**.

**Restoring a backup.** → Quit Crosslister, move the current `data/` folder aside, create a new `data/` folder, unzip the backup into it, and start Crosslister (previews regenerate automatically). To merge a backup into your current inventory instead, use **Import → Backup** (accepts the backup ZIP or an export JSON).

**Where are the logs?** → The **Logs** page (filter by marketplace or search), or the daily files in `logs/`. **Settings → About → Open in Finder** opens the folder.

**Resetting a marketplace session.** → Settings → Marketplaces → **Disconnect** (deletes the saved login), then **Connect** again.

**A scan found nothing, or an import says it couldn't read the page.** → The marketplace's page looks different from what the app expects, or you weren't on your listings page when you clicked Continue. → Open your shop/closet page in the browser window and retry; for other sites paste the listing URLs instead. Pages without structured data (title, price, photos) can't be read.

**"AI is turned off in Settings." / "The AI model didn't respond".** → AI is disabled, or the model server isn't running. → Settings → AI → **Test connection**. For Ollama, run `ollama serve` and `ollama pull gemma3:4b`.

**A field wasn't filled.** → Open Activity → the job → **Download trace**, or run `npm run trace:report -- latest <marketplace>`, and follow `docs/TRACES.md`.

**A sale was detected but nothing else changed.** → "When an item sells, remove it from the other marketplaces automatically" is off (Settings → Sales), so the banner only offers to mark the item sold. Click **Review** to mark it sold and choose where to remove it.
