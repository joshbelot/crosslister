# 10 — Export and Backup (M15)

The user must never be locked in. Everything is downloadable as open formats.

Service files: `services/exporter.ts` (JSON, CSV), `services/backup.ts` (ZIP). Routes in `routes/export.ts`. These are `GET` routes so the browser can download them directly.

## 1. JSON export — `GET /api/export/json`

`Content-Disposition: attachment; filename="crosslister-export-YYYY-MM-DD.json"`.

```json
{
  "exportVersion": 1,
  "app": "crosslister",
  "exportedAt": "2026-10-08T12:00:00.000Z",
  "listings": [
    {
      "...all Listing fields (02 §5.1)": "",
      "photos": [
        { "id": "…", "position": 0, "originalFilename": "IMG_0012.HEIC", "file": "listings/<listingId>/original/<photoId>.heic",
          "sha256": "…", "width": 4032, "height": 3024, "rotation": 0, "crop": null }
      ],
      "marketplaces": [
        { "marketplaceId": "mercari", "status": "active", "remoteId": "m123…", "url": "https://…", "titleOverride": null,
          "descriptionOverride": null, "priceOverrideCents": null, "data": {}, "verified": true,
          "listedAt": "…", "endedAt": null, "lastSyncedAt": "…" }
      ]
    }
  ]
}
```
`file` paths are relative to the data directory. Includes archived and sold listings. Excludes jobs, logs, settings secrets.

## 2. CSV export — `GET /api/export/csv`

One row per listing, UTF-8 with BOM (Excel-friendly), RFC 4180 quoting (quote every field containing `"`, `,`, CR or LF; double inner quotes). Columns, in order:

`sku, id, title, description, price, msrp, cost, condition, category, brand, model, size, colors, material, quantity, tags, weight_oz, status, source, sold_at, sold_price, sold_on, created_at, updated_at, photo_count, primary_photo_file`, then for each marketplace in `MARKETPLACE_ORDER`: `<mp>_status, <mp>_id, <mp>_url`.

Prices are decimal dollars (`65.00`); `category` is the path label; `colors` and `tags` are `;`-joined. Write it with a small local `toCsvRow(values: string[])` helper — no dependency.

## 3. Full backup ZIP — `GET /api/export/backup`

1. `db.$client.backup(<data/backups/tmp-<ts>.db>)` (better-sqlite3 online backup → consistent snapshot).
2. Stream a ZIP (`archiver('zip', { zlib: { level: 6 } })`) to both the HTTP response and `data/backups/crosslister-backup-YYYY-MM-DD-HHmm.zip` (use a `PassThrough` tee, or write the file first and then stream it — **write the file first, then send it**; simpler and keeps a local copy).
3. ZIP contents:
   - `crosslister.db` (the snapshot)
   - `export.json` (same as §1)
   - `listings/<id>/original/*` (originals only; derived and processed files are regenerable)
   - `README.txt`: "Crosslister backup created <date>. To restore: quit Crosslister, move your current data folder aside, create a new data folder, unzip this archive into it, and start Crosslister. Or use Import → Restore from backup in the app."
4. Delete the temp `.db`. Keep the newest 10 backups in `data/backups/`, delete older ones.

Excluded on purpose: `browser-profiles/` (session cookies), `data/secrets/`, Keychain items, `.env`, logs, screenshots.

`GET /api/export/backups` → `{ items: Array<{ name, bytes, createdAt }> }`; `GET /api/export/backups/:name` → download (validate `name` against `/^crosslister-backup-[\d-]+\.zip$/`).

## 4. Restore

- **Manual (always works)**: documented in `README.txt` above, README.md and TROUBLESHOOTING.md. Unzipping a backup into an empty data folder restores everything, because `crosslister.db` plus `listings/*/original/*` is the full state; derived images are regenerated on demand (add a startup check: for each photo missing `derived/<id>_thumb.jpg` or `_display.jpg`, regenerate it in the background, logging progress).
- **In-app**: Import → Restore from backup (07 §5.4), which merges into the current inventory instead of replacing it.

## 5. Tests

- JSON export contains every listing with photos and marketplace rows; `exportVersion` 1.
- CSV: header order, quoting of commas/quotes/newlines, per-marketplace columns.
- Backup ZIP contains `crosslister.db`, `export.json`, originals, README; excludes `derived/`, `processed/`; retention keeps 10.
- Derived regeneration recreates a deleted thumb.
