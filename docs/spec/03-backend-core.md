# 03 — Backend Core (M4–M7)

## 1. Entry point and app factory

### `src/server/index.ts`

Startup sequence, in this order:

1. `import './config'` (loads `.env` via `dotenv/config`).
2. `ensureDirs()` (from `paths.ts`).
3. `const db = openDb(paths.dbFile)`; `runMigrations(db)`.
4. `initLogger(db)`; log `info SERVER "Starting Crosslister"`.
5. `purgeOldLogs(db, 30)` (DB rows and `logs/*.log` older than 30 days).
6. `cleanupEmptyDrafts(db)` — delete listings where `status='draft'`, `title=''`, `description=''`, no photos, and `createdAt` older than 24 h (also remove their folders).
7. `recoverInterruptedJobs(db)` (05 §6.6).
8. `const app = await buildApp({ db })`.
9. `await app.listen({ host: '127.0.0.1', port: config.port })`.
10. Log `info SERVER "Crosslister is running: open http://localhost:5173"` in dev, `http://localhost:4317` in production.
11. On `SIGINT`/`SIGTERM`: `await browserManager.closeAll()`, `await app.close()`, `db.$client.close()`, `process.exit(0)`.

### `src/server/app.ts`

```ts
export interface AppDeps { db: Db; startJobRunner?: boolean } // default true; tests pass false and drive the runner manually
export async function buildApp(deps: AppDeps): Promise<FastifyInstance>;
```

- `Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 })` (our own logger is used).
- Decorate `app.db`, register security hook (§3), error handler (§4), `@fastify/multipart` with `{ limits: { fileSize: MAX_UPLOAD_BYTES, files: 30 } }`.
- Register every route module from `src/server/routes/*` with prefix `/api`.
- If `config.isProd`: register `@fastify/static` with `root: dist/web`, and `setNotFoundHandler`: URL starts with `/api` → 404 JSON; otherwise send `index.html` (SPA fallback).
- If `startJobRunner`: `jobRunner.start(db)`.

## 2. Config and paths

### `src/server/config.ts`

```ts
import 'dotenv/config';
export const config = {
  port: Number(process.env.PORT ?? 4317),
  isProd: process.env.NODE_ENV === 'production',
  dataDir: path.resolve(process.env.CROSSLISTER_DATA_DIR ?? './data'),
  profilesDir: path.resolve(process.env.CROSSLISTER_PROFILES_DIR ?? './browser-profiles'),
  logsDir: path.resolve('./logs'),
  secretsBackend: (process.env.CROSSLISTER_SECRETS_BACKEND ?? (process.platform === 'darwin' ? 'keychain' : 'file')) as 'keychain' | 'file',
  ebay: {
    env: (process.env.EBAY_ENV ?? 'production') as 'production' | 'sandbox',
    clientId: process.env.EBAY_CLIENT_ID ?? '',
    clientSecret: process.env.EBAY_CLIENT_SECRET ?? '',
    ruName: process.env.EBAY_RUNAME ?? '',
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  openaiCompatibleApiKey: process.env.OPENAI_COMPATIBLE_API_KEY ?? '',
};
```

Tests override `CROSSLISTER_DATA_DIR` to a temp dir **before** importing server modules (see 11 §2).

### `src/server/paths.ts`

```ts
export const paths = {
  dbFile: path.join(config.dataDir, 'crosslister.db'),
  listingsDir: path.join(config.dataDir, 'listings'),
  backupsDir: path.join(config.dataDir, 'backups'),
  screenshotsDir: path.join(config.dataDir, 'screenshots'),
  importsDir: path.join(config.dataDir, 'imports'),
  tmpDir: path.join(config.dataDir, 'tmp'),
  secretsDir: path.join(config.dataDir, 'secrets'),
  logsDir: config.logsDir,
  profilesDir: config.profilesDir,
};
export const listingDir = (id: string) => path.join(paths.listingsDir, id);
export const originalDir = (id: string) => path.join(listingDir(id), 'original');
export const derivedDir = (id: string) => path.join(listingDir(id), 'derived');
export const processedDir = (id: string, mp: MarketplaceId) => path.join(listingDir(id), 'processed', mp);
export const profileDir = (mp: MarketplaceId) => path.join(paths.profilesDir, mp);
export function ensureDirs(): void; // mkdir -p every directory in `paths` (not files)
```

Photo layout on disk:

```text
data/listings/<listingId>/
  original/<photoId>.<ext>           ← byte-for-byte upload, never modified
  derived/<photoId>_source.jpg       ← only for HEIC/HEIF: full-size JPEG conversion used as processing source
  derived/<photoId>_thumb.jpg        ← 400px long edge
  derived/<photoId>_display.jpg      ← 1600px long edge
  processed/<marketplaceId>/01.jpg … ← generated per publish job, ordered by position
```

## 3. Security hook (`onRequest`)

The API can drive logged-in browsers, so block requests from other websites (DNS rebinding / CSRF).

```ts
const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`, '127.0.0.1:5173', 'localhost:5173']);
app.addHook('onRequest', async (req, reply) => {
  const host = req.headers.host ?? '';
  if (!allowedHosts.has(host)) throw new AppError('FORBIDDEN_HOST', 403, 'Request blocked.');
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (mutating) {
    const origin = req.headers.origin;
    if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) throw new AppError('FORBIDDEN_ORIGIN', 403, 'Request blocked.');
    if (req.headers['x-crosslister'] !== '1') throw new AppError('MISSING_HEADER', 403, 'Request blocked.');
  }
});
```

- No CORS plugin; never send `Access-Control-Allow-*` headers.
- The web API client sends `X-Crosslister: 1` on every request (custom headers force a CORS preflight from foreign origins, which fails).
- The eBay OAuth callback route (`GET`) is exempt from nothing — it is a GET from the user's own browser to `localhost:4317`, which passes.

## 4. Errors (`src/server/errors.ts`)

```ts
export class AppError extends Error {
  constructor(public code: string, public status: number, public userMessage: string, public details?: unknown) { super(userMessage); }
}
export const notFound = (what: string) => new AppError('NOT_FOUND', 404, `${what} was not found.`);
```

Fastify `setErrorHandler`:

| Error | Status | Body |
|---|---|---|
| `AppError` | its status | `{ error: { code, message: userMessage, details } }` |
| `ZodError` | 400 | `{ error: { code: 'VALIDATION', message: 'Some fields are invalid.', issues: err.issues } }` |
| Fastify multipart `FST_REQ_FILE_TOO_LARGE` | 413 | `{ error: { code: 'FILE_TOO_LARGE', message: 'That photo is larger than 50 MB.' } }` |
| anything else | 500 | `{ error: { code: 'INTERNAL', message: 'Something went wrong. Details were written to the log.' } }` and `logger.error('SERVER', err.message, { data: { stack } })` |

## 5. Logger (`src/server/services/logger.ts`)

```ts
type Level = 'debug' | 'info' | 'warn' | 'error';
interface LogCtx { listingId?: string | null; jobId?: string | null; marketplaceId?: MarketplaceId | null; data?: unknown }
export const logger: {
  debug(scope: string, message: string, ctx?: LogCtx): void;
  info(scope: string, message: string, ctx?: LogCtx): void;
  warn(scope: string, message: string, ctx?: LogCtx): void;
  error(scope: string, message: string, ctx?: LogCtx): void;
};
export function initLogger(db: Db): void;
export function purgeOldLogs(db: Db, days: number): void;
```

- `scope` is upper-case: marketplace IDs (`MERCARI`, `POSHMARK`, …) or `SERVER`, `JOBS`, `PHOTOS`, `IMPORT`, `EXPORT`, `AI`, `BROWSER`.
- Every call writes to: (a) console, (b) `logs/app-YYYY-MM-DD.log` (local date; append with a per-day `fs.WriteStream`), (c) `logs` table (skip `debug` in the table), (d) emits `{ type: 'log', entry }` on the event bus for `info`+.
- Line format (console and file), local time:

```text
2026-10-08 12:30:04 INFO  [POSHMARK] Uploading 6 photos  (job=abc123 listing=k3j2h1)
```

- Redaction: before writing `data`, recursively replace values of keys matching `/token|secret|password|authorization|cookie|api[-_]?key/i` with `"[redacted]"`.
- Before `initLogger` is called (or in tests without DB), log to console only.

## 6. Event bus and SSE

### `src/server/services/events.ts`

```ts
export type AppEvent =
  | { type: 'job.updated'; job: Job }                       // any job field/state change (includes steps)
  | { type: 'listing.updated'; listingId: string }
  | { type: 'listing.deleted'; listingId: string }
  | { type: 'connection.updated'; marketplaceId: MarketplaceId }
  | { type: 'import.updated'; batchId: string }
  | { type: 'sale.detected'; listingId: string; marketplaceId: MarketplaceId }
  | { type: 'log'; entry: LogEntry };
export const events: { publish(e: AppEvent): void; subscribe(fn: (e: AppEvent) => void): () => void };
```

Put the `AppEvent` type in `src/shared/types.ts` (the web uses it). Implementation: Node `EventEmitter` with `setMaxListeners(50)`.

### `src/server/routes/events.ts` — `GET /api/events`

```ts
app.get('/events', (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const send = (e: AppEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const unsubscribe = events.subscribe(send);
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.raw.on('close', () => { clearInterval(ping); unsubscribe(); });
});
```

## 7. Settings (`services/settings.ts`, `routes/settings.ts`)

```ts
export const DEFAULT_SETTINGS: Settings = {
  shippingDefaults: { weightOz: null, lengthIn: null, widthIn: null, heightIn: null, whoPays: 'buyer' },
  descriptionFooter: '',
  defaultMarketplaces: ['mercari', 'poshmark', 'depop', 'facebook'],
  rememberLastMarketplaces: true,
  marketplaces: {
    mercari:  { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    poshmark: { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    depop:    { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    facebook: { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 10 },
    ebay:     { enabled: true,  autoSubmit: true,  priceAdjustPercent: 0, dailyLimit: 50 },
    grailed:  { enabled: true,  autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    vinted:   { enabled: false, autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    offerup:  { enabled: false, autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    etsy:     { enabled: false, autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 25 },
    other:    { enabled: false, autoSubmit: false, priceAdjustPercent: 0, dailyLimit: 100 },
  },
  browser: { channel: 'chrome', slowMoMs: 0, closeIdleMinutes: 20 },
  ebay: { fulfillmentPolicyId: null, paymentPolicyId: null, returnPolicyId: null, postalCode: '', dispatchTimeDays: 1 },
  ai: { enabled: false, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', textModel: 'gemma3:4b', visionModel: 'gemma3:4b' },
  statusChecks: { ebayPollingEnabled: false, ebayIntervalMinutes: 30 },
};
export function getSettings(db: Db): Settings;          // deep-merge stored 'app' value over DEFAULT_SETTINGS (stored wins; unknown keys dropped)
export function saveSettings(db: Db, s: Settings): Settings; // validates with settingsSchema; forces marketplaces.facebook.autoSubmit=false and autoSubmit=false for every adapter whose capabilities.autoSubmitAllowed is false
export function getKv<T>(db: Db, key: string, fallback: T): T;
export function setKv(db: Db, key: string, value: unknown): void;
```

KV keys used across the app: `app` (Settings), `sku_counter` (`{ next }`), `last_marketplaces` (`MarketplaceId[]`), `recent_categories` (`string[]`, max 8, most recent first), `ebay_auth_meta` (`{ connectedAt, scopes, accessTokenExpiresAt }` — no tokens), `category_map_<marketplaceId>` (`Record<canonicalCategoryId, string>` user category mappings, 05 §1.1).

Additional routes for category maps:
- `GET /api/settings/category-map/:mp` → `{ map: Record<string, string>, builtIn: Record<string, string> }` where `builtIn` is the adapter's default path for every selectable canonical category rendered as `A > B > C` (synonym arrays rendered with their first entry), or omitted if unmapped.
- `PUT /api/settings/category-map/:mp` body `{ map }` → saves (drop empty values).

Routes:
- `GET /api/settings` → `Settings`.
- `PUT /api/settings` body `Settings` → `Settings`.
- `GET /api/settings/kv/recent` → `{ recentCategories: string[], lastMarketplaces: MarketplaceId[], brands: string[] }` where `brands` = up to 200 distinct non-empty `listings.brand` ordered by most recent `updatedAt`.

## 8. Listings (`services/listings.ts`, `routes/listings.ts`)

### 8.1 Service functions

```ts
export function createListing(db: Db, input: ListingPatch): ListingDetail;
export function getListing(db: Db, id: string): ListingDetail;            // throws notFound('Listing')
export function updateListing(db: Db, id: string, patch: ListingPatch): ListingDetail;
export function deleteListing(db: Db, id: string, opts: { force: boolean }): void;
export function duplicateListing(db: Db, id: string): Promise<ListingDetail>;
export function archiveListing(db: Db, id: string): ListingDetail;      // sets archivedAt=now
export function unarchiveListing(db: Db, id: string): ListingDetail;    // archivedAt=null
export function listListings(db: Db, q: ListQuery): { items: ListingSummary[]; counts: Record<InventoryFilter, number> };
export function toSummary(detail: ListingDetail): ListingSummary;
```

Rules:
- `createListing`: allocate SKU, apply defaults (02 §10), merge `input`, set `createdAt=updatedAt=now`, insert, `recomputeListingStatus`, emit `listing.updated`. If the request includes `categoryId`, push it to `recent_categories`.
- `updateListing`: validate with `listingPatchSchema`; normalize `size` with `normalizeSize(size, sizeTypeOf(categoryId))`; trim `title`, `brand`, `model`; dedupe `tags` case-insensitively; set `updatedAt`; recompute status; emit. If `categoryId` changed, update `recent_categories`.
- `deleteListing`: if any marketplace listing is `active` and `!force` → `AppError('LISTING_HAS_ACTIVE', 409, 'This item is still live on a marketplace. Deactivate it first, or delete anyway.')`. Cancel non-terminal jobs for it, delete rows (cascade), `fs.rm(listingDir(id), { recursive: true, force: true })`, emit `listing.deleted`.
- `duplicateListing`: new listing with all canonical fields copied except `sku`, `status`, `sold*`, `saleDetected*`, `archivedAt`, `source` (→ `'created'`); copies each photo's **original** file to the new listing with new photo IDs, same rotation/crop/position, regenerates derived files; creates marketplace listing rows for the same marketplace IDs with status `not_listed` and no overrides/data.
- `getListing` returns `ListingDetail` with photos ordered by `position`, marketplace listings ordered by `MARKETPLACE_ORDER`, `activeJobs` (non-terminal jobs for the listing, with `steps`), `needsAttention`.

### 8.2 List query

`ListQuery = { filter: InventoryFilter; q: string; sort: 'updated_desc' | 'created_desc' | 'price_desc' | 'price_asc' | 'title_asc'; }` (defaults `all`, `''`, `updated_desc`).

Implementation (personal scale — at most a few thousand rows — so filtering is done in memory):
1. Load all listings, all marketplace listings, all photos with `position=0`, photo counts, and the latest job per (listing, marketplace) plus any `NEEDS_USER` jobs.
2. Build summaries; compute `needsAttention`.
3. Search: split `q` on whitespace; every term must case-insensitively appear in `title`, `brand`, `sku`, `size`, `description`, or `model`.
4. `counts` are computed **after search, before the status filter**, for every filter value.
5. Filter: `all` excludes `archived`; `draft` = status `draft` or `ready`; `listed` = `listed`; `partially_listed`; `sold`; `archived`; `needs_attention` = `needsAttention && status !== 'archived'`.
6. Sort; `price_*` puts null prices last.

### 8.3 Routes

| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/listings` | `?filter&q&sort` | `{ items: ListingSummary[], counts }` |
| `POST /api/listings` | `ListingPatch` | `ListingDetail` (201) |
| `GET /api/listings/:id` | — | `ListingDetail` |
| `PATCH /api/listings/:id` | `ListingPatch` | `ListingDetail` |
| `DELETE /api/listings/:id` | `?force=1` | `204` |
| `POST /api/listings/:id/duplicate` | — | `ListingDetail` (201) |
| `POST /api/listings/:id/archive` | — | `ListingDetail` |
| `POST /api/listings/:id/unarchive` | — | `ListingDetail` |

Marketplace-related listing routes are in 05 §5 and 08.

## 9. Photos (`services/photos.ts`, `routes/photos.ts`)

### 9.1 Upload — `POST /api/listings/:id/photos` (multipart, field name `files`, multiple)

For each file **sequentially**:

1. Extension (lower-cased) must be in `ACCEPTED_IMAGE_EXTENSIONS`, else skip with a per-file error `"<name>: unsupported file type. Use JPG, PNG, WEBP or HEIC."`.
2. If listing already has `MAX_PHOTOS_PER_LISTING` photos → per-file error `"<name>: a listing can have at most 24 photos."`.
3. Stream to `data/tmp/<random>` while computing SHA-256. If a photo with the same `sha256` exists on this listing → delete temp, per-file note `"<name>: already added (skipped)."`.
4. `photoId = nanoid12()`; move temp to `original/<photoId><ext>`.
5. If ext is `.heic`/`.heif`: `await convertHeicToJpeg(originalPath, derived/<photoId>_source.jpg)` (§10.2).
6. Read dimensions from the processing source with sharp metadata; if EXIF `orientation` is 5–8 swap width/height.
7. `await generateDerived(photo)` (thumb + display) and `dhash = await computeDhash(displayPath)`.
8. Insert row with `position = (max position) + 1` (0 for the first photo).

Response: `{ photos: Photo[] /* all photos of the listing */, errors: string[], notes: string[] }`. Then `recomputeListingStatus` and emit `listing.updated`.

### 9.2 Other photo routes

| Method & path | Body | Behavior |
|---|---|---|
| `PATCH /api/listings/:id/photos/order` | `{ photoIds }` | Must be exactly the listing's photo ID set (else 400 `PHOTO_ORDER_MISMATCH`). Set `position = index` in one transaction. Returns `Photo[]`. "Make primary" in the UI = move to index 0 and call this. |
| `PATCH /api/photos/:photoId` | `{ rotation?, crop? }` | If `rotation` changes, `crop` resets to `null` unless provided in the same request. `version += 1`. Regenerate derived + dhash. Returns `Photo`. |
| `DELETE /api/photos/:photoId` | — | Delete row and files (`original/<id>.*`, `derived/<id>_*`), re-number positions 0..n-1. `204`. |
| `GET /api/photos/:photoId/thumb` | `?v=` | Serve `derived/<id>_thumb.jpg`; `Cache-Control: public, max-age=31536000, immutable`. |
| `GET /api/photos/:photoId/display` | `?v=` | Serve `derived/<id>_display.jpg`; same caching. With `?uncropped=1`: serve `derived/<id>_uncropped.jpg` (rotated, **not** cropped, 1600 px), rendering it first if missing or older than the current `version` (store the version in the filename: `<id>_uncropped_v<version>.jpg`, deleting older ones). Used by the crop UI. |
| `GET /api/photos/:photoId/original` | — | Serve original with stored `mimeType`, `Content-Disposition: inline; filename="<originalFilename>"`. |

Photo `urls` in API responses: `{ thumb: /api/photos/<id>/thumb?v=<version>, display: /api/photos/<id>/display?v=<version>, original: /api/photos/<id>/original }`.

## 10. Image processing (`services/imageProcessing.ts`)

### 10.1 Rendering pipeline

```ts
export interface RenderOptions { maxLongEdge: number; quality: number }
export async function renderPhoto(photo: PhotoRow, out: string, opts: RenderOptions): Promise<{ width: number; height: number }>;
```

Steps (sharp):
1. `src = sourcePath(photo)` → `derived/<id>_source.jpg` if it exists, else the original.
2. `let img = sharp(src, { failOn: 'none' }).rotate()` (auto-orient from EXIF).
3. If `photo.rotation` ≠ 0: `img = img.rotate(photo.rotation)`.
4. If `photo.crop`: materialize the rotated buffer (`await img.toBuffer({ resolveWithObject: true })`), compute `left = round(x*W)`, `top = round(y*H)`, `width = min(W-left, round(w*W))`, `height = min(H-top, round(h*H))`, then `sharp(buffer).extract(...)`.
5. `.resize({ width: maxLongEdge, height: maxLongEdge, fit: 'inside', withoutEnlargement: true })`.
6. `.toColourspace('srgb').jpeg({ quality, mozjpeg: true })` → file. sharp drops EXIF/GPS metadata by default — **do not** call `withMetadata()` (privacy: strips location).

Derived sizes: thumb `{ maxLongEdge: 400, quality: 78 }`, display `{ maxLongEdge: 1600, quality: 85 }`.

### 10.2 HEIC

```ts
export async function convertHeicToJpeg(input: string, output: string): Promise<void>;
```
- On macOS: `execFile('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', input, '--out', output])`.
- Elsewhere: try `sharp(input).jpeg({ quality: 95 }).toFile(output)`; on failure throw `AppError('HEIC_UNSUPPORTED', 415, 'HEIC photos can only be converted on a Mac. Export them as JPEG and try again.')`.

### 10.3 Perceptual hash

```ts
export async function computeDhash(file: string): Promise<string>; // 16 hex chars
export function hammingDistance(a: string, b: string): number;     // 0..64
```
`sharp(file).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()` → for rows `y=0..7`, cols `x=0..7`: bit = `px[y*9+x] < px[y*9+x+1] ? 1 : 0`, most significant bit first → 64-bit → hex (use `BigInt`).

### 10.4 Marketplace copies

```ts
export interface PhotoSpec { maxPhotos: number; maxLongEdge: number; quality: number }
export async function preparePhotosForMarketplace(listingId: string, mp: MarketplaceId, photos: PhotoRow[], spec: PhotoSpec): Promise<string[]>;
```
- Empty and recreate `processed/<mp>/`.
- Take photos ordered by `position`, first `spec.maxPhotos`.
- Render each to `processed/<mp>/NN.jpg` (`01.jpg`, `02.jpg`, …).
- Return absolute paths in order. Default spec values when an adapter does not override: `maxLongEdge 2048`, `quality 88`.

## 11. Secrets (`services/secrets.ts`)

```ts
export async function getSecret(name: string): Promise<string | null>;
export async function setSecret(name: string, value: string): Promise<void>;
export async function deleteSecret(name: string): Promise<void>;
```
- `keychain` backend (macOS): service `crosslister`, account `name`.
  - get: `security find-generic-password -s crosslister -a <name> -w` (exit code 44 → `null`).
  - set: `security add-generic-password -U -s crosslister -a <name> -w <value>`.
  - delete: `security delete-generic-password -s crosslister -a <name>` (ignore "not found").
- `file` backend: `data/secrets/<name>.json` containing `{ "value": "…" }`, written with mode `0o600`.
- Secret names used: `ebay_refresh_token`, `ebay_access_token` (JSON `{ token, expiresAt }`).
- Never log secret values; never return them from any API.

## 12. Desktop notifications (`services/notify.ts`)

```ts
export function notifyUser(title: string, message: string): void;
```
macOS only: `execFile('osascript', ['-e', `display notification ${q(message)} with title ${q(title)}`])` where `q` wraps in double quotes and escapes `\` and `"`. No-op elsewhere. Never throws. Called when a job enters `NEEDS_USER` or `FAILED`.

## 13. Health

`GET /api/health` → `{ ok: true, version: <package.json version>, dataDir, profilesDir, logsDir, backupsDir, platform: process.platform }`.

`POST /api/system/open-folder` body `{ which: 'data' | 'logs' | 'profiles' | 'backups' }` → on macOS `execFile('open', [dir])`, returns `{ path }`; elsewhere just returns `{ path }`.

## 14. Logs route

`GET /api/logs?level=info&marketplaceId=&listingId=&jobId=&q=&limit=200&before=<id>` → `{ items: LogEntry[] }` newest first. `level` means "this level and above".
