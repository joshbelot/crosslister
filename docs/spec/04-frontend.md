# 04 — Frontend (M10–M16, plus UI parts of later milestones)

React 19 + Vite + TypeScript, TanStack Query for server state, React Router 7 (`createBrowserRouter`), Tailwind CSS 4, `lucide-react` icons, `sonner` toasts, `@dnd-kit` for photo reordering, `react-dropzone` for drops, `react-easy-crop` for cropping. Desktop-first (min width 1024 px); no dark mode; no mobile layout work.

Speed is the product: the create-listing screen must allow a complete listing in 1–2 minutes with no mouse trips that aren't necessary.

## 1. Structure

```text
src/web/
  main.tsx              QueryClientProvider (staleTime 5 s, refetchOnWindowFocus true, retry 1) + RouterProvider + <Toaster position="bottom-right" richColors />
  App.tsx               router definition
  styles.css            @import "tailwindcss";  + a few component classes (see §14)
  api/client.ts         fetch wrapper
  api/hooks.ts          react-query hooks
  api/events.ts         useEventStream()
  lib/format.ts         re-exports shared money/text helpers; formatDate, timeAgo
  lib/keyboard.ts       useHotkeys()
  components/…          (§3–§11)
  pages/
    InventoryPage.tsx
    ListingEditorPage.tsx
    ListingDetailPage.tsx
    ImportPage.tsx      (Phase 4)
    SettingsPage.tsx
    LogsPage.tsx
```

Routes:

| Path | Element |
|---|---|
| `/` | `InventoryPage` |
| `/new` | redirect → `/listings/new/edit` |
| `/listings/:id/edit` | `ListingEditorPage` (`id === 'new'` → unsaved new listing) |
| `/listings/:id` | `ListingDetailPage` |
| `/import` | `ImportPage` |
| `/settings` | `SettingsPage` (`?tab=general|marketplaces|ebay|ai|backup|about`) |
| `/logs` | `LogsPage` |

All pages render inside `Layout` (§3).

## 2. API layer

### 2.1 `api/client.ts`

```ts
export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
export const api = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<void>;
  upload<T>(path: string, files: File[]): Promise<T>;   // multipart, field "files"
};
```
Every request sends `X-Crosslister: 1`; JSON requests send `Content-Type: application/json`. Non-2xx → parse `{ error: { code, message, details } }` → throw `ApiError` (fallback message "Couldn't reach the app server. Is it running?" for network errors).

Global mutation error handling: every mutation's `onError` shows `toast.error(err.message)` unless the caller handles it.

### 2.2 `api/hooks.ts` (query keys)

| Hook | Key / endpoint |
|---|---|
| `useListings(query)` | `['listings', query]` → `GET /api/listings` |
| `useListing(id)` | `['listing', id]` → `GET /api/listings/:id` (disabled for `new`) |
| `useValidation(id, mps)` | `['validation', id, mps]` |
| `useMarketplaces()` | `['marketplaces']` |
| `useJobs({ listingId?, active? })` | `['jobs', params]` |
| `useSettings()` | `['settings']` |
| `useRecent()` | `['recent']` → `GET /api/settings/kv/recent` |
| `useLogs(filters)` | `['logs', filters]` (infinite query with `before`) |
| `useCategoryMap(mp)` | `['category-map', mp]` |
| mutations | `useCreateListing`, `usePatchListing`, `useDeleteListing`, `useDuplicateListing`, `useArchive`, `useUploadPhotos`, `useReorderPhotos`, `useEditPhoto`, `useDeletePhoto`, `useSetTargets`, `usePatchTarget`, `useCrosslist`, `useMarkListed`, `useMarkEnded`, `useDeactivate`, `useDeactivateAll`, `useMarkSold`, `useUpdateRemote`, `useJobContinue`, `useJobCancel`, `useJobRetry`, `useConnect`, `useDisconnect`, `useSaveSettings`, `useSaveCategoryMap` |

Mutations invalidate `['listing', id]`, `['listings']` and `['jobs']` as relevant.

### 2.3 `api/events.ts` — `useEventStream()`

Mounted once in `Layout`. Opens `new EventSource('/api/events')` (auto-reconnects). On message:
- `job.updated` → update the job inside any cached `['jobs', …]` arrays (`setQueriesData`), invalidate `['listing', job.listingId]` and `['listings']`; if `state === 'NEEDS_USER'` → open the Activity drawer and `toast.warning(job.needsUser.title)`; if `FAILED` → `toast.error(<N> failed)`.
- `listing.updated` / `listing.deleted` → invalidate `['listing', id]`, `['listings']`, `['validation', id]`.
- `connection.updated` → invalidate `['marketplaces']`.
- `import.updated` → invalidate `['import', batchId]`.
- `sale.detected` → invalidate listings; `toast('Sale detected', …)`.
- `log` → push into `['logs-live']` (LogsPage prepends).

Exposes `connected: boolean`; Layout shows a small "Reconnecting…" pill when false.

## 3. Layout and shell (M10)

- **Top bar** (h-14, white, bottom border): left "Crosslister" wordmark (link `/`); nav links Inventory, Import, Settings, Logs; right: **New Listing** primary button (`+ New Listing`, shortcut hint `N`) and **Activity** button (icon `Activity`; red badge = number of `NEEDS_USER` jobs; spinner overlay while any job is `IN_PROGRESS`).
- **Activity drawer** (§8): right-side panel 420 px, overlays content, toggled by the button or `A`.
- **Sale-detected banner** (§9.4) renders under the top bar on every page when applicable.
- Shortcut help modal on `?` lists §13.

## 4. Inventory page (M11)

Layout top to bottom:
1. Header row: search input (left, `placeholder="Search inventory…"`, shows `/` hint, debounced 200 ms), sort select (Recently updated, Recently created, Price high→low, Price low→high, Title A→Z), **Import** button, **+ New Listing**.
2. Filter tabs: All · Drafts · Listed · Partially listed · Sold · Archived · Needs attention — each with its count from `counts`; Needs attention count in red when > 0.
3. List (rows, not cards). Row (h-20): 64 px square thumbnail (primary photo `thumb`, gray placeholder icon if none) · title (font-medium, truncate) with SKU (zinc-500, mono, small) and `brand · size` below · price (`formatCentsShort`) · status pill · marketplace badges.
4. Empty state: "No items yet." + **New Listing** button + hint "or press N".

Marketplace badge (`MarketplaceBadge`): short name + status icon:

| status | style |
|---|---|
| active | green-600 text, `Check` icon |
| in_progress | blue-600, spinning `Loader2` |
| error | red-600, `X` icon |
| sold | violet-600, `BadgeDollarSign` |
| ended | zinc-400, `Minus` |
| not_listed | zinc-400 outline, `Circle` |

Clicking a badge with a URL opens it in a new tab (stopPropagation). Row click → `/listings/:id`. Row hover shows icon buttons: Edit, Cross-list (→ `/listings/:id/edit?crosslist=1`), Duplicate.

State lives in the URL (`?filter=&q=&sort=`). Keyboard: `/` focus search, `N` new, `J`/`K` move highlight, `Enter` open, `E` edit highlighted.

## 5. Listing editor (M12) — `ListingEditorPage`

The most important screen. Single centered column, `max-w-5xl`, generous spacing. Sections in this exact order:

1. **Header**: "New Listing" or the title; SKU chip; `SaveIndicator` (right).
2. **Photos** (`PhotoManager`, §6).
3. **Core fields** (two-column grid, labels above inputs; element IDs `field-<name>` for "Fix" links):
   - Row: **Title** (full width) with counter `n / L` where `L` = smallest `titleMaxLength` among selected marketplaces (amber when exceeded, tooltip "Will be shortened on Poshmark, Mercari").
   - Row: **Description** (full width textarea, auto-grow, min 5 rows) with counter vs smallest `descriptionMaxLength` among selected marketplaces (red when exceeded).
   - Row: **Price** (`PriceInput`) · **Condition** (`ConditionPicker`)
   - Row: **Brand** (`BrandInput`) · **Category** (`CategoryPicker`)
   - Row: **Size** (`SizeInput`) · **Color** (`ColorPicker`)
4. **More details** — collapsible, collapsed by default, open state remembered in `localStorage['editor.moreOpen']`:
   - Model · Original price (MSRP) (`PriceInput`, help "Required by Poshmark")
   - Material · Quantity (number, min 1)
   - Condition notes (textarea, help "Flaws or notes — added to the description automatically")
   - Measurements (inches; apparel set for women/men/kids departments: Chest, Waist, Hip, Inseam, Rise, Length, Shoulder, Sleeve; otherwise Width, Height, Depth)
   - Tags (chip input: Enter or comma adds, Backspace removes last, max 20)
   - Shipping: Weight (`lb` + `oz` inputs → `weightOz = lb*16 + oz`), Package L × W × H (in), Who pays (Buyer/Seller segmented)
   - Cost (private, help "Only for your records") · Private notes (textarea, "Never sent to marketplaces")
5. **Cross-list to** (`MarketplaceChips`, §7.1) + link "Customize per marketplace" (opens `MarketplaceOverridesPanel`, §7.3).
6. **Sticky footer bar** (bottom of viewport): left `SaveIndicator`; center a readiness summary from `useValidation` ("3 ready · 1 needs info", clickable → opens validation modal); right **Cross-List Item** primary button (`⌘↵`). If the listing has active marketplace listings and title/description/price changed since load, show the "Push changes?" banner above the footer (05 §7.5).

### 5.1 Field components

- `PriceInput`: text input with `$` prefix; on blur parse with `parsePriceToCents`; invalid → red border + "Enter a price like 65 or 65.50"; displays `(cents/100).toFixed(2)`.
- `ConditionPicker`: six segmented buttons (labels from `CONDITION_LABELS`, tooltip `CONDITION_HINTS`); keys `1`–`6` select while the group has focus; arrow keys move.
- `BrandInput`: text input with dropdown suggestions from `useRecent().brands` (case-insensitive prefix match first, then contains; max 8); free text always allowed; Tab accepts the highlighted suggestion.
- `CategoryPicker`: button showing `categoryPathLabel(id)` or "Choose category". Opens a popover with an autofocused search box; list shows "Recent" (from `recentCategories`) then all selectable categories as full path labels; filter = every search token appears in the normalized path label; ↑/↓/Enter/Esc keyboard. Selecting closes the popover and focuses Size (or Color if size type is `none`).
- `SizeInput`: text input + preset chips from `SIZE_PRESETS[sizeTypeOf(categoryId)]` (hidden when `none`; then the input is disabled with placeholder "Not needed"). Clicking a chip sets the value.
- `ColorPicker`: swatches from `COLORS` (circle + label); up to 2 selected (selection order kept); selecting a third shows toast "Pick up to 2 colors".

### 5.2 Autosave and creation

- `useListingDraft(id)` keeps local form state. Changes mark fields dirty; after 800 ms idle, `PATCH` only dirty fields; on success clear those dirty flags. `SaveIndicator`: "Saving…" / "Saved" / "Couldn't save — retrying" (retry after 2 s, 5 s, 10 s, then every 30 s). `⌘S` flushes immediately. Flush on route change and `beforeunload`.
- Server data replaces local state only on first load and for fields that are not dirty (SSE invalidations must never overwrite what the user is typing).
- **New listing** (`id === 'new'`): nothing is created until the first user action (photos dropped/pasted/chosen, or any field typed). Then: `POST /api/listings` with current local fields → `PUT /api/listings/:id/marketplaces` with the initial marketplace selection → upload queued photos → `navigate('/listings/<id>/edit', { replace: true })`. Because it is the same route, the component stays mounted; keep a ref of the created id to avoid reloading local state.
- Initial marketplace selection for a new listing: `settings.rememberLastMarketplaces ? recent.lastMarketplaces : settings.defaultMarketplaces`, filtered to enabled marketplaces.
- Initial `shipping` = `settings.shippingDefaults`.
- Focus: on a new listing the dropzone is focused; after the first photos finish uploading, focus Title if empty.
- `?crosslist=1` in the URL opens the validation modal once data has loaded.
- **Duplicate** from the detail page lands here with the new listing's id.

## 6. Photo manager (M12) — `PhotoManager`

- **No photos**: a large dropzone (h-64, dashed border): "Drop photos here" / "or click to choose · ⌘O". Accepts `ACCEPTED_IMAGE_EXTENSIONS`.
- **With photos**: a grid (5 columns, square tiles, gap-3) of `PhotoTile`s followed by an "Add photos" tile; counter `8 / 24` at the top right.
- **Whole-page drop**: while dragging files over the editor, show a full-screen overlay "Drop to add photos". `⌘V` with images on the clipboard adds them.
- **Uploading**: placeholder tiles with spinners for each file; uploads are sent in one multipart request per drop; on response replace placeholders with the returned photos; show `errors` as toast errors and `notes` as toast info.
- `PhotoTile`: thumbnail (`thumb` URL); first tile shows a "Cover" badge; hover toolbar: **Make cover** (Star; moves to index 0), **Rotate** (RotateCw; +90° clockwise → `PATCH { rotation }`), **Crop** (Crop; opens `CropModal`), **Delete** (Trash2; inline confirm "Delete photo?" Yes/No).
- **Reorder** by drag (`@dnd-kit/sortable`, `rectSortingStrategy`): optimistic reorder, then `PATCH /photos/order`; on error revert + toast.
- **Lightbox**: clicking a tile opens a modal with the `display` image, ←/→ to navigate, `Esc` to close, and the same actions.
- `CropModal`: `react-easy-crop` on the **uncropped** rotated image (`/api/photos/:id/display?uncropped=1&v=`); aspect buttons Original · 1:1 · 4:5 · 3:4 (default 1:1); zoom slider; **Save** → `PATCH { crop: croppedArea / 100 }` (react-easy-crop percentages → 0..1); **Reset** → `PATCH { crop: null }`.
## 7. Marketplace selection, validation, overrides (M13)

### 7.1 `MarketplaceChips`

A wrap row of toggle chips, one per **enabled** marketplace in `MARKETPLACE_ORDER`. Chip content: name, a kind tag (`API` / `Assisted` / `Manual`), and a connection dot (green connected, amber unknown, red logged_out / not_configured; manual = no dot). Selected chips are filled indigo. Keyboard: chips are buttons in tab order; Space toggles. Changes call `PUT /api/listings/:id/marketplaces` (debounced 300 ms; queued until the listing exists). If Facebook is selected show helper text under the row: "Facebook: you'll always click Publish yourself." A trailing "Manage" link goes to Settings → Marketplaces.

### 7.2 Validation modal — `ValidationModal`

Opened by **Cross-List Item** (after flushing autosave). Title: "Cross-listing validation". Content:
- Canonical errors (if any) at top in a red box, each with **Fix** (closes modal, scrolls to and focuses `field-<name>`).
- One row per selected marketplace: name + kind tag; status: `✓ Ready` (green) / `⚠ Ready with warnings` (amber) / `✗ Missing information` (red); expandable issue list; each issue has **Fix** → canonical field, or opens `MarketplaceOverridesPanel` on that marketplace's tab (for `data.*` fields or marketplace-specific issues). If the marketplace's connection is not `connected` (browser kind) add an info line "Not connected — you'll be asked to log in."; eBay `not_configured` is an error (from validation).
- Footer: **Cancel**, primary **Cross-list to N marketplaces** (N = ready count; disabled at 0). Enter = primary.
- First time Poshmark is included, show the Poshmark notice confirm (06 §3.1) before sending.
- On confirm: `POST /crosslist` with ready IDs → close modal → open Activity drawer → for each `skipped` show `toast.info('<N>: <reason>')`.

### 7.3 `MarketplaceOverridesPanel`

A right-side sheet (560 px) with one tab per selected marketplace. Per tab:
- **Preview** (from `GET …/preview`): final title (with "shortened" tag), final price, description (pre-wrap, scrollable, char count vs limit), mapping rows (`describeMapping`), photo count.
- **Overrides**: Title override, Description override (textarea), Price override (`PriceInput`; placeholder shows the computed price). Empty = use default. Saved on blur via `PATCH …/marketplaces/:mp`.
- **Marketplace fields**: render `adapter.dataFields` with `DataFieldInput`:
  - `text`/`textarea`/`number`/`money`/`boolean`/`select`/`tags` → obvious inputs.
  - `path` → text input with placeholder `Women > Shoes > Sneakers` and help text.
  - `ebay_category` → `EbayCategoryField`: shows current `categoryName` (+ "auto" tag if `categoryAuto`); a search box calling `/api/marketplaces/ebay/categories/suggest?q=` (debounced 300 ms) listing results with full paths; choosing one saves `{ categoryId, categoryName, categoryAuto: false, requiredAspects }` (fetch `/aspects` to compute `requiredAspects`).
  - `ebay_aspects` → `EbayAspectsField`: loads `/aspects?categoryId=`; shows required aspects first (red asterisk), then recommended (collapsed "More item specifics"); each aspect: combobox with allowed values (`SELECTION_ONLY` → must pick; `FREE_TEXT` → suggestions + free text; `multi` → chips). Values that `autoAspects` would fill are shown as placeholders "Auto: Nike". Saves `data.aspects`.
  - eBay `conditionId` select options loaded from `/conditions?categoryId=`; first option "Automatic".

## 8. Activity drawer and job cards (M13)

`ActivityDrawer` lists jobs from `useJobs({ active: true })` plus live updates, grouped by listing (group header = listing title, link to detail), newest group first. It auto-opens when a cross-list starts or any job enters `NEEDS_USER`.

`JobCard` (one per job): header = marketplace name + action label (publish "Publishing", update "Updating", deactivate "Removing", connect "Connecting", status_check "Checking status", import_* "Importing") + state pill. Body = step list: icon per step state (done `Check` green, running `Loader2` spin, needs_user `AlertTriangle` amber, failed `X` red, skipped/pending `Minus` gray), label, optional message (small), screenshot thumbnail (click → full image in new tab).

State-specific blocks:
- **NEEDS_USER** → `NeedsUserCard` (amber background):
  - Title (e.g. "⚠ Poshmark requires your attention") and instructions.
  - `missingFields` as a bullet list ("Fill these in the browser: Category, Size").
  - `copyFields`: rows `Label` + value preview (2 lines max) + **Copy** button (`navigator.clipboard.writeText`, toast "Copied <label>").
  - `link` → button opening `link.url` in a new tab. `photoFolder` → **Open photos folder** (`POST …/open-photos`).
  - `allowUrlInput` → input "Listing URL (optional)".
  - Buttons: primary `primaryAction` (→ `POST /api/jobs/:id/continue { url }`), secondary **Cancel** (confirm).
- **FAILED** → red block: "❌ <N> failed", "Reason: <errorMessage>", for publish jobs the line "Your listing has NOT been marked as successfully listed.", buttons **Retry**, **Open <N>** (ml url, else marketplace sell URL), **Mark as listed…** (inline URL input → `mark-listed`).
- **SUCCESS** → compact green line: "✓ Listed on <N>" + **View listing** (url) or "(unverified)" when `verified` is false; for deactivate "✓ Removed from <N>".
- **CANCELLED** → gray "Cancelled".

## 9. Listing detail page (M14)

- **Header**: title, SKU chip, status pill, price. Buttons: **Edit** (`E`), **Cross-list** (→ editor with `?crosslist=1`), **Duplicate**, **Mark Sold**, **Deactivate Everywhere** (only when ≥1 active), overflow menu: Archive/Unarchive, Delete (confirm; on `LISTING_HAS_ACTIVE` show second confirm "It's still live on X. Delete anyway?" → `?force=1`).
- **Photos**: large display image + thumbnail strip; click → lightbox.
- **Details** grid (label/value): Condition, Category path, Brand, Size, Colors (swatches), Model, Material, Quantity, MSRP, Cost (private tag), Measurements, Tags, Shipping (weight `1 lb 4 oz`, dims, who pays), Private notes (shaded box "Private").
- **Description** block (`whitespace-pre-wrap`).
- **Marketplace status** table: Marketplace · Status (badge) · Listing ID (mono, copy button) · Link (`Open ↗`) · Last sync (`timeAgo`) · Error (red, wraps) · Actions. Rows for every target plus a muted "Not listed" row for each other enabled marketplace with **Add & cross-list**. Actions by status:
  - `not_listed` → Cross-list, Remove
  - `in_progress` → View progress (opens drawer)
  - `active` → Update (if supported), Deactivate, Mark as ended (manual), "(unverified)" tag when `!verified` with **Add URL** (→ mark-listed)
  - `error` → Retry (crosslist this one), Mark as listed…, Remove
  - `sold` / `ended` → Relist (crosslist again), Remove
- **History**: collapsible list of jobs for this listing (`useJobs({ listingId })`): time, marketplace, action, state, error.

### 9.1 Mark sold modal — `MarkSoldModal` (08 §1)

Fields: **Sold on** (select: active marketplaces + "Elsewhere / in person"; preselect `saleDetectedMarketplaceId` if set), **Sale price** (`PriceInput`, default = that marketplace's effective price, else base price), **Date** (date input, default today). Checklist **Remove from other marketplaces**: every other `active` target, all checked. Buttons: primary **Mark sold & remove from N** (N = checked count; label "Mark sold" when 0), secondary **Cancel**. Calls `POST /api/listings/:id/mark-sold`; then opens the Activity drawer if jobs were created.

### 9.2 Deactivate everywhere modal

Checklist of active targets (all checked) → **Remove from N marketplaces** → `POST /api/listings/:id/deactivate-all { marketplaceIds }`.

### 9.3 Relist / remove

Relist calls `POST /crosslist { marketplaceIds: [mp] }` (allowed for `ended`, `sold`, `error`, `not_listed`).

### 9.4 Sale detected banner (Phase 5)

For each listing with `saleDetectedMarketplaceId`: amber banner "<title> sold on <N>. Remove it from the other marketplaces?" buttons **Review** (opens `MarkSoldModal` for it) and **Dismiss** (`POST /api/listings/:id/dismiss-sale`).

## 10. Settings page (M15, M20, M23, M35)

Tabs (left vertical list): General · Marketplaces · eBay · AI · Backup & Export · About. One **Save** button per tab (bottom right; disabled until changed). Settings are loaded and saved as the full object (`PUT /api/settings`).

### 10.1 General
Shipping defaults (weight lb/oz, L×W×H, who pays) · Description footer (textarea, counter /500, help "Added to the end of every description") · Default marketplaces (chips) · "Remember the marketplaces I used last" (toggle) · Browser: Chrome / Playwright Chromium (radio) · Close idle browser windows after N minutes.

### 10.2 Marketplaces
One card per marketplace (all ten, in order). Card content:
- Name, kind tag, **Enabled** toggle.
- Connection: status text + account name + "checked 5 min ago"; buttons **Connect** / **Log in again** (→ `POST /connect`; opens the Activity drawer) and **Disconnect** (confirm "This deletes the saved browser session for <N>. You'll need to log in again."). Manual marketplaces show "Manual — nothing to connect."
- **"Click the final Publish button for me"** toggle (`autoSubmit`); disabled with explanation for Facebook ("Facebook always requires you to click Publish.") and manual marketplaces. Help: "Off (recommended): the app fills the form and you click Publish."
- **Price adjustment** % (number, −50…100) with live example "$65.00 → $72.00".
- **Daily limit** (number).
- **Category mapping…** (browser adapters) → modal: table of all selectable canonical categories: Canonical path · Built-in mapping (gray, or "—") · Your mapping (text input `A > B > C`). Save → `PUT /api/settings/category-map/:mp`.

### 10.3 eBay
Checklist:
1. **App credentials**: ✓ if configured, else ✗ with the missing variable names and "See docs/SETUP.md → Connect eBay".
2. **Account**: Connected as `<user>` / **Connect eBay** / **Disconnect**.
3. **Business policies**: three selects (Shipping, Payment, Return) from `GET /api/marketplaces/ebay/policies` + **Refresh**; disabled until connected; help "Create these once in eBay Seller Hub → Account → Business policies."
4. **Item location ZIP** and **Handling time (days)**.
5. **Status polling** toggle + interval minutes (Phase 5).

### 10.4 AI (Phase 6)
Enabled toggle; provider (Ollama local / OpenAI-compatible local server / Anthropic API); base URL; text model; vision model; **Test connection** (`GET /api/ai/health` → toast with result). Note: "AI is optional. Suggestions are never applied without your review."

### 10.5 Backup & Export
Buttons: **Export inventory (JSON)**, **Export inventory (CSV)**, **Create full backup (ZIP)** — each triggers a download (`window.location = '/api/export/…'`; these GETs need no custom header). List of backups in `data/backups/` (name, size, date, download). Restore instructions text (10 §4) and **Restore from export JSON…** (→ `/import?source=backup`, Phase 4).

### 10.6 About
Version, platform, data folder, profiles folder, logs folder — each with **Open in Finder** (`POST /api/system/open-folder { which }`, macOS only; add this route to `routes/health.ts`: `which ∈ data|logs|profiles|backups` → `execFile('open', [dir])`).

## 11. Logs page (M16)

Filters: level (Info+, Warnings+, Errors only), marketplace (All or one), search text. Table: time (local), level (colored), scope, message (+ links "listing"/"job" when present). Infinite scroll / **Load more**. Live entries (`['logs-live']`) are prepended when they match the filters. Button **Open log folder**.

## 12. Import page (M27+)

Specified in 07 §4.

## 13. Keyboard shortcuts (`lib/keyboard.ts`)

`useHotkeys(map)` ignores single-key shortcuts while focus is in an input, textarea, select or contenteditable; `⌘` combos always work.

| Where | Keys | Action |
|---|---|---|
| Global | `N` | New listing |
| Global | `A` | Toggle Activity drawer |
| Global | `G` then `I` / `S` / `L` | Go to Inventory / Settings / Logs |
| Global | `?` | Shortcut help |
| Inventory | `/` | Focus search |
| Inventory | `J` / `K`, `Enter`, `E` | Move, open, edit |
| Editor | `⌘S` | Save now |
| Editor | `⌘Enter` | Cross-list (opens validation modal) |
| Editor | `⌘O` | Choose photos |
| Editor | `⌘V` | Paste photos |
| Editor | `1`–`6` | Condition (when condition group focused) |
| Detail | `E` | Edit |
| Detail | `⌘Enter` | Cross-list |
| Modals | `Esc` / `Enter` | Close / primary action |

## 14. Visual style

- Tailwind defaults; neutral `zinc` palette, accent `indigo-600`; body `bg-zinc-50`, cards `bg-white rounded-xl border border-zinc-200 shadow-sm`.
- Inputs: `h-10 rounded-lg border-zinc-300 focus:ring-2 focus:ring-indigo-500`; labels `text-sm font-medium text-zinc-700`; help text `text-xs text-zinc-500`; errors `text-xs text-red-600`.
- Buttons: primary `bg-indigo-600 text-white hover:bg-indigo-700`, secondary `bg-white border`, danger `bg-red-600 text-white`. Define `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.input`, `.card` with `@apply` in `styles.css`.
- Status pill colors: draft zinc, ready sky, partially_listed amber, listed green, sold violet, archived zinc-400.
- Every async button shows a spinner and is disabled while pending. Every destructive action has a confirm.
