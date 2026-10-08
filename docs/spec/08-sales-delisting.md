# 08 — Sales and Delisting (M14, M33, M34)

V1 (Phase 1–3): the user marks an item sold manually and the app removes it from the other marketplaces. Phase 5 adds status checks and sale detection.

## 1. Mark sold — `POST /api/listings/:id/mark-sold` (M14)

Body (`markSoldSchema`): `{ marketplaceId: MarketplaceId | 'elsewhere', soldPriceCents?, soldAt?, deactivateMarketplaceIds: MarketplaceId[] }`.

Service `markSold(db, id, body)`:
1. Listing: `soldAt = body.soldAt ?? now`, `soldPriceCents = body.soldPriceCents ?? effective price on that marketplace ?? priceCents`, `soldMarketplaceId`, clear `saleDetectedMarketplaceId`/`saleDetectedAt`.
2. If `marketplaceId` ≠ `'elsewhere'` and that marketplace listing exists → status `sold`, `endedAt = soldAt`.
3. For each id in `deactivateMarketplaceIds` whose marketplace listing is `active`: create a `deactivate` job (05 §7.3). Ignore others.
4. `recomputeListingStatus` → `sold`. Log `info <MP|SERVER> Marked sold`.
5. Response `{ listing: ListingDetail, jobs: Job[] }`.

`POST /api/listings/:id/unmark-sold` (undo): clears `sold*` fields; the sold marketplace listing goes back to `active` if it was set to `sold` by `mark-sold` less than 24 h ago, otherwise stays. UI: "Undo" action in the toast after marking sold (10 s) and an "Undo sold" button on the detail page header for sold items.

## 2. Deactivate everywhere — `POST /api/listings/:id/deactivate-all` (M14)

Body `{ marketplaceIds?: MarketplaceId[] }` (default: all `active`). Creates one `deactivate` job per active marketplace listing. Response `{ jobs }`. In Phase 1 every adapter is manual, so each job asks the user to remove the listing and confirm (06 §1); later phases automate per adapter.

The listing's status stays `sold` (or its computed status if not sold) while jobs run; `needsAttention` remains true until no `active` marketplace listing remains on a sold item.

## 3. Status checks (M33)

Job type `status_check` per marketplace listing. Adapter `checkStatus(ctx, ml): Promise<RemoteStatus>`.

- **eBay** (`statusCheck: 'api'`): 06 §5.11.
- **Browser adapters** (`statusCheck: 'browser'`): open `ml.url`; `extractProduct(page)` (07 §5.2) → `availability` (`sold`/`ended`/`active`); if unknown, adapter `soldIndicator?: LocatorSpec` (e.g. text `/^sold$/i` badge) → `sold`; a 404/"not found" page (`page.title()` or text `/not found|no longer available|removed/i`) → `ended`; else `unknown`. Never logs in automatically: if a login wall appears, return `unknown` (don't pause for the user in background checks).
- **Facebook / manual**: `none` (no checks).

Outcome handling (`applyRemoteStatus(db, ml, status)`):
- `active` → `lastSyncedAt=now`.
- `sold` → ml `status='sold'`, `endedAt=now`; if the listing is not already sold: set `saleDetectedMarketplaceId=mp`, `saleDetectedAt=now`, emit `sale.detected`, `notifyUser('Sale detected', '<title> sold on <N>')`. **Never** auto-mark the listing sold and never auto-deactivate other marketplaces.
- `ended` → ml `status='ended'`, `endedAt=now`.
- `unknown` → only `lastSyncedAt` unchanged; log `info`.

Triggers:
- `POST /api/listings/:id/check-status` → `status_check` jobs for all active targets whose adapter supports checks.
- `POST /api/status-checks/run` body `{ marketplaceIds? }` → jobs for every active marketplace listing (browser ones run sequentially per marketplace with `ctx.sleep(5000–10000)` between pages). UI: Inventory header overflow menu → **Check listing statuses**; shows a toast with the number of jobs.

## 4. Sale detection and polling (M34)

- `GET /api/listings` and `ListingDetail` already expose `saleDetectedMarketplaceId`; `needsAttention` includes it (02 §8).
- UI banner (04 §9.4) → **Review** opens `MarkSoldModal` preselected; **Dismiss** → `POST /api/listings/:id/dismiss-sale` clears the two fields (ml stays `sold`).
- **eBay polling**: when `settings.statusChecks.ebayPollingEnabled`, a timer in `jobRunner` (checked every minute) creates `status_check` jobs for all active eBay marketplace listings every `ebayIntervalMinutes`, skipping if previous ones are still pending. Use one `GetMyeBaySelling` `SoldList` call (`<SoldList><Include>true</Include><DurationInDays>7</DurationInDays></SoldList>`) per poll when more than 5 eBay listings are active, instead of one `GetItem` per listing (match `ItemID`s; treat items in the sold list as `sold`).
- Browser marketplaces are **never** polled on a timer in V1 (respect the platforms; avoid background automation).
