# 02 — Data Model (M2, M3)

All shared code lives in `src/shared/` and must not import Node-only or browser-only modules (it is used by server and web).

## 1. `src/shared/constants.ts`

```ts
export const MARKETPLACE_IDS = [
  'mercari', 'poshmark', 'depop', 'facebook', 'ebay', 'grailed', 'vinted', 'offerup', 'etsy', 'other',
] as const;
export type MarketplaceId = (typeof MARKETPLACE_IDS)[number];

export const MARKETPLACE_NAMES: Record<MarketplaceId, string> = {
  mercari: 'Mercari', poshmark: 'Poshmark', depop: 'Depop', facebook: 'Facebook Marketplace',
  ebay: 'eBay', grailed: 'Grailed', vinted: 'Vinted', offerup: 'OfferUp', etsy: 'Etsy', other: 'Other',
};

/** Short labels for badges in tight UI. */
export const MARKETPLACE_SHORT: Record<MarketplaceId, string> = {
  mercari: 'Mercari', poshmark: 'Posh', depop: 'Depop', facebook: 'FB', ebay: 'eBay',
  grailed: 'Grailed', vinted: 'Vinted', offerup: 'OfferUp', etsy: 'Etsy', other: 'Other',
};

/** Display order everywhere (selection chips, tables). */
export const MARKETPLACE_ORDER: MarketplaceId[] = [
  'mercari', 'poshmark', 'depop', 'facebook', 'ebay', 'grailed', 'vinted', 'offerup', 'etsy', 'other',
];

export const CONDITIONS = ['new_with_tags', 'new_without_tags', 'like_new', 'good', 'fair', 'poor'] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABELS: Record<Condition, string> = {
  new_with_tags: 'New with tags',
  new_without_tags: 'New without tags',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};
export const CONDITION_HINTS: Record<Condition, string> = {
  new_with_tags: 'Unused, original tags attached',
  new_without_tags: 'Unused, no tags',
  like_new: 'Used once or twice, no visible wear',
  good: 'Gently used, minor wear',
  fair: 'Noticeable wear or flaws',
  poor: 'Major flaws, for parts or repair',
};

export const LISTING_STATUSES = ['draft', 'ready', 'partially_listed', 'listed', 'sold', 'archived'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const MARKETPLACE_LISTING_STATUSES = ['not_listed', 'in_progress', 'active', 'sold', 'ended', 'error'] as const;
export type MarketplaceListingStatus = (typeof MARKETPLACE_LISTING_STATUSES)[number];

export const JOB_TYPES = ['publish', 'update', 'deactivate', 'connect', 'status_check', 'import_scan', 'import_fetch'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATES = ['NOT_STARTED', 'IN_PROGRESS', 'NEEDS_USER', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
export type JobState = (typeof JOB_STATES)[number];
export const TERMINAL_JOB_STATES: JobState[] = ['SUCCESS', 'FAILED', 'CANCELLED'];

export const STEP_STATES = ['pending', 'running', 'done', 'skipped', 'needs_user', 'failed'] as const;
export type StepState = (typeof STEP_STATES)[number];

export const INVENTORY_FILTERS = ['all', 'draft', 'listed', 'partially_listed', 'sold', 'archived', 'needs_attention'] as const;
export type InventoryFilter = (typeof INVENTORY_FILTERS)[number];

export const MAX_PHOTOS_PER_LISTING = 24;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
export const SERVER_PORT_DEFAULT = 4317;
```

## 2. `src/shared/taxonomy.ts` — canonical categories

Our own small, marketplace-neutral category tree. Adapters map these IDs to their own categories. IDs are dot paths; the first segment is the **department**.

```ts
export type SizeType =
  | 'letter' | 'womens_numeric' | 'waist' | 'shoe_men' | 'shoe_women' | 'kids' | 'one_size' | 'none';

export interface CategoryNode {
  id: string;
  label: string;           // label of this node only, e.g. "Sneakers"
  parentId: string | null;
  selectable: boolean;     // leaves are selectable; departments/groups are not
  sizeType?: SizeType;     // inherited by children when absent
}

type Def = [id: string, label: string, sizeType?: SizeType];

// Departments
const DEPARTMENTS: Def[] = [
  ['women', 'Women'], ['men', 'Men'], ['kids', 'Kids'], ['home', 'Home'],
  ['electronics', 'Electronics'], ['collectibles', 'Collectibles & Media'], ['other', 'Other'],
];

// Groups (not selectable) — children listed in LEAVES
const GROUPS: Def[] = [
  ['women.tops', 'Tops', 'letter'], ['women.bottoms', 'Bottoms', 'letter'], ['women.outerwear', 'Outerwear', 'letter'],
  ['women.shoes', 'Shoes', 'shoe_women'], ['women.bags', 'Bags', 'one_size'], ['women.accessories', 'Accessories', 'one_size'],
  ['men.tops', 'Tops', 'letter'], ['men.bottoms', 'Bottoms', 'waist'], ['men.outerwear', 'Outerwear', 'letter'],
  ['men.shoes', 'Shoes', 'shoe_men'], ['men.accessories', 'Accessories', 'one_size'],
];

const LEAVES: Def[] = [
  // Women
  ['women.tops.t_shirts', 'T-Shirts'], ['women.tops.blouses', 'Blouses & Shirts'], ['women.tops.sweaters', 'Sweaters'],
  ['women.tops.sweatshirts_hoodies', 'Sweatshirts & Hoodies'], ['women.tops.tank_tops', 'Tank Tops & Camis'],
  ['women.bottoms.jeans', 'Jeans', 'waist'], ['women.bottoms.pants', 'Pants'], ['women.bottoms.shorts', 'Shorts'],
  ['women.bottoms.skirts', 'Skirts'], ['women.bottoms.leggings', 'Leggings'],
  ['women.dresses', 'Dresses', 'letter'],
  ['women.outerwear.jackets', 'Jackets'], ['women.outerwear.coats', 'Coats'], ['women.outerwear.vests', 'Vests'],
  ['women.activewear', 'Activewear', 'letter'], ['women.swimwear', 'Swimwear', 'letter'],
  ['women.shoes.sneakers', 'Sneakers'], ['women.shoes.boots', 'Boots'], ['women.shoes.heels', 'Heels'],
  ['women.shoes.flats', 'Flats & Loafers'], ['women.shoes.sandals', 'Sandals'],
  ['women.bags.handbags', 'Handbags'], ['women.bags.backpacks', 'Backpacks'], ['women.bags.wallets', 'Wallets'],
  ['women.accessories.hats', 'Hats'], ['women.accessories.scarves', 'Scarves'], ['women.accessories.belts', 'Belts'],
  ['women.accessories.sunglasses', 'Sunglasses'],
  ['women.jewelry', 'Jewelry', 'none'],
  // Men
  ['men.tops.t_shirts', 'T-Shirts'], ['men.tops.shirts', 'Button-Down Shirts'], ['men.tops.polos', 'Polos'],
  ['men.tops.sweaters', 'Sweaters'], ['men.tops.sweatshirts_hoodies', 'Sweatshirts & Hoodies'],
  ['men.bottoms.jeans', 'Jeans'], ['men.bottoms.pants', 'Pants'], ['men.bottoms.shorts', 'Shorts'],
  ['men.outerwear.jackets', 'Jackets'], ['men.outerwear.coats', 'Coats'], ['men.outerwear.vests', 'Vests'],
  ['men.suits_blazers', 'Suits & Blazers', 'letter'], ['men.activewear', 'Activewear', 'letter'],
  ['men.swimwear', 'Swimwear', 'letter'],
  ['men.shoes.sneakers', 'Sneakers'], ['men.shoes.boots', 'Boots'], ['men.shoes.dress_shoes', 'Dress Shoes'],
  ['men.shoes.sandals', 'Sandals'],
  ['men.bags', 'Bags', 'one_size'],
  ['men.accessories.hats', 'Hats'], ['men.accessories.belts', 'Belts'], ['men.accessories.sunglasses', 'Sunglasses'],
  ['men.accessories.watches', 'Watches'], ['men.accessories.ties', 'Ties'],
  ['men.jewelry', 'Jewelry', 'none'],
  // Kids
  ['kids.girls_clothing', 'Girls Clothing', 'kids'], ['kids.boys_clothing', 'Boys Clothing', 'kids'],
  ['kids.baby_clothing', 'Baby Clothing', 'kids'], ['kids.shoes', 'Kids Shoes', 'kids'], ['kids.toys', 'Toys', 'none'],
  // Home
  ['home.decor', 'Decor', 'none'], ['home.kitchen_dining', 'Kitchen & Dining', 'none'], ['home.bedding_bath', 'Bedding & Bath', 'none'],
  // Electronics
  ['electronics.phones', 'Cell Phones', 'none'], ['electronics.computers_tablets', 'Computers & Tablets', 'none'],
  ['electronics.video_games', 'Video Games & Consoles', 'none'], ['electronics.audio', 'Audio & Headphones', 'none'],
  ['electronics.cameras', 'Cameras', 'none'],
  // Collectibles & media
  ['collectibles.trading_cards', 'Trading Cards', 'none'], ['collectibles.vinyl_records', 'Vinyl Records', 'none'],
  ['collectibles.books', 'Books', 'none'], ['collectibles.toys_figures', 'Action Figures & Collectible Toys', 'none'],
  // Other
  ['other.other', 'Other', 'none'],
];

function parentOf(id: string): string | null {
  const i = id.lastIndexOf('.');
  return i === -1 ? null : id.slice(0, i);
}

export const CATEGORIES: CategoryNode[] = [
  ...DEPARTMENTS.map(([id, label, sizeType]) => ({ id, label, parentId: null, selectable: false, sizeType })),
  ...GROUPS.map(([id, label, sizeType]) => ({ id, label, parentId: parentOf(id), selectable: false, sizeType })),
  ...LEAVES.map(([id, label, sizeType]) => ({ id, label, parentId: parentOf(id), selectable: true, sizeType })),
];

export const CATEGORY_BY_ID: Map<string, CategoryNode> = new Map(CATEGORIES.map((c) => [c.id, c]));
export function getCategory(id: string | null | undefined): CategoryNode | undefined;
/** ['women','women.shoes','women.shoes.sneakers'] → nodes from root to leaf. */
export function categoryAncestry(id: string): CategoryNode[];
/** "Women › Shoes › Sneakers" */
export function categoryPathLabel(id: string): string;
/** First segment: 'women' | 'men' | ... */
export function departmentOf(id: string): string;
/** Walk up ancestry; first defined sizeType; default 'none'. */
export function sizeTypeOf(id: string | null | undefined): SizeType;
export function isSelectableCategory(id: string): boolean;
/** Lookup helper for adapter maps: tries id, then each ancestor id, returns first hit. */
export function lookupByCategory<T>(map: Partial<Record<string, T>>, id: string): T | undefined;
```

Implement the declared functions. `sizeTypeOf` for unknown id returns `'none'`.

## 3. `src/shared/colors.ts`

```ts
export const COLORS = [
  { id: 'black', label: 'Black', hex: '#111111' }, { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'gray', label: 'Gray', hex: '#9ca3af' }, { id: 'brown', label: 'Brown', hex: '#7c4a21' },
  { id: 'tan', label: 'Tan', hex: '#d2b48c' }, { id: 'beige', label: 'Beige', hex: '#e8dcc4' },
  { id: 'cream', label: 'Cream', hex: '#fffdd0' }, { id: 'red', label: 'Red', hex: '#dc2626' },
  { id: 'pink', label: 'Pink', hex: '#f472b6' }, { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'yellow', label: 'Yellow', hex: '#facc15' }, { id: 'green', label: 'Green', hex: '#16a34a' },
  { id: 'blue', label: 'Blue', hex: '#2563eb' }, { id: 'navy', label: 'Navy', hex: '#1e3a8a' },
  { id: 'purple', label: 'Purple', hex: '#9333ea' }, { id: 'gold', label: 'Gold', hex: '#d4af37' },
  { id: 'silver', label: 'Silver', hex: '#c0c0c0' }, { id: 'multicolor', label: 'Multicolor', hex: 'conic-gradient' },
] as const;
export type ColorId = (typeof COLORS)[number]['id'];
export const COLOR_IDS: ColorId[] = COLORS.map((c) => c.id);
export const MAX_COLORS = 2;
```

## 4. `src/shared/sizes.ts`

```ts
import type { SizeType } from './taxonomy';

export const SIZE_PRESETS: Record<SizeType, string[]> = {
  letter: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  womens_numeric: ['00', '0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20'],
  waist: ['26', '27', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40', '42', '44'],
  shoe_men: ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '14', '15'],
  shoe_women: ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '12'],
  kids: ['0-3M', '3-6M', '6-12M', '12-18M', '18-24M', '2T', '3T', '4T', '5', '6', '7', '8', '10', '12', '14', '16'],
  one_size: ['One Size'],
  none: [],
};

/** Normalize user input: trim, uppercase letters for letter sizes ("xl" → "XL"), "os"/"one size" → "One Size". */
export function normalizeSize(input: string, sizeType: SizeType): string;
```

```ts
/** Synonyms used when matching a size against a marketplace's size options. First entry is the size itself. */
export function sizeSynonyms(size: string): string[];
```
Table: `XXS ↔ XX-Small`, `XS ↔ X-Small, Extra Small`, `S ↔ Small`, `M ↔ Medium`, `L ↔ Large`, `XL ↔ X-Large, Extra Large`, `XXL ↔ XX-Large, 2XL`, `3XL ↔ XXX-Large, XXXL`, `One Size ↔ OS, One size, O/S`. Numeric sizes return `[size, 'US ' + size, size + ' US']` (e.g. `11` → `['11','US 11','11 US']`). Waist sizes additionally `'W' + size`.

The size field is always free text; presets are quick-pick chips. `normalizeSize` rules: trim; collapse whitespace; if `/^(os|one ?size|o\/s)$/i` → `'One Size'`; if sizeType is `letter` and the value case-insensitively equals a preset → the preset; `xxxl` → `3XL`; otherwise return trimmed input unchanged.

## 5. `src/shared/types.ts` and `src/shared/schemas.ts`

### 5.1 Types (`types.ts`)

```ts
import type { Condition, ListingStatus, MarketplaceId, MarketplaceListingStatus, JobState, JobType, StepState } from './constants';
import type { ColorId } from './colors';

export interface Measurements {
  chestIn?: number; waistIn?: number; hipIn?: number; inseamIn?: number; riseIn?: number;
  lengthIn?: number; shoulderIn?: number; sleeveIn?: number;
  widthIn?: number; heightIn?: number; depthIn?: number;
}

export interface ShippingInfo {
  weightOz: number | null;      // package weight incl. packaging, ounces
  lengthIn: number | null;      // package dimensions, inches
  widthIn: number | null;
  heightIn: number | null;
  whoPays: 'buyer' | 'seller';
}

export interface PhotoCrop { x: number; y: number; width: number; height: number } // normalized 0..1, relative to the rotated image

export interface Photo {
  id: string;
  listingId: string;
  position: number;             // 0 = primary/cover
  originalFilename: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  dhash: string | null;
  rotation: 0 | 90 | 180 | 270;
  crop: PhotoCrop | null;
  version: number;              // increments on rotate/crop; used for cache busting
  urls: { thumb: string; display: string; original: string }; // computed in API responses
  createdAt: string;
}

export interface MarketplaceListing {
  id: string;
  listingId: string;
  marketplaceId: MarketplaceId;
  status: MarketplaceListingStatus;
  remoteId: string | null;
  url: string | null;
  titleOverride: string | null;
  descriptionOverride: string | null;
  priceOverrideCents: number | null;
  data: Record<string, unknown>;   // marketplace-specific fields, validated by adapter.dataSchema
  verified: boolean;               // false when user marked listed without a URL
  lastError: string | null;
  lastErrorCode: string | null;
  listedAt: string | null;
  endedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Listing {
  id: string;
  sku: string;
  title: string;
  description: string;
  priceCents: number | null;
  msrpCents: number | null;
  costCents: number | null;
  currency: 'USD';
  condition: Condition | null;
  conditionNotes: string;
  categoryId: string | null;
  brand: string;
  model: string;
  size: string;
  colors: ColorId[];
  material: string;
  quantity: number;
  measurements: Measurements;
  tags: string[];
  shipping: ShippingInfo;
  notes: string;                  // private, never sent to marketplaces
  status: ListingStatus;
  source: 'created' | 'imported';
  soldAt: string | null;
  soldPriceCents: number | null;
  soldMarketplaceId: MarketplaceId | 'elsewhere' | null;
  saleDetectedMarketplaceId: MarketplaceId | null;
  saleDetectedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListingDetail extends Listing {
  photos: Photo[];
  marketplaces: MarketplaceListing[];
  activeJobs: Job[];             // non-terminal jobs for this listing
  needsAttention: boolean;
}

export interface ListingSummary {
  id: string; sku: string; title: string; priceCents: number | null; status: ListingStatus;
  brand: string; size: string; categoryId: string | null;
  primaryPhotoUrl: string | null; photoCount: number;
  marketplaces: Array<{ marketplaceId: MarketplaceId; status: MarketplaceListingStatus; url: string | null }>;
  needsAttention: boolean;
  updatedAt: string; createdAt: string;
}

export interface ValidationIssue {
  field: string;                 // canonical field name ('title','photos','size',...) or 'data.<key>' for marketplace data
  severity: 'error' | 'warning';
  message: string;               // user-facing sentence
}

export interface MarketplaceValidation {
  marketplaceId: MarketplaceId;
  ready: boolean;                // no errors
  issues: ValidationIssue[];
  preview: { title: string | null; priceCents: number | null; photoCount: number };
}

export interface ValidationReport {
  canonical: ValidationIssue[];
  marketplaces: MarketplaceValidation[];
}

export interface CopyField { label: string; value: string }

export interface NeedsUserRequest {
  reason: 'login' | 'verification' | 'fields' | 'review_and_submit' | 'confirm_delete' | 'manual_listing' | 'manual_delist' | 'other';
  title: string;                  // e.g. "Poshmark requires your attention"
  instructions: string;           // plain-language instructions
  missingFields?: string[];       // labels of fields the app could not fill
  copyFields?: CopyField[];       // values offered with copy buttons
  allowUrlInput?: boolean;        // show "Listing URL" input
  photoFolder?: string;           // absolute path to processed photos for "Open photos folder"
  link?: { label: string; url: string }; // e.g. "Open Vinted" or the eBay sign-in URL; UI opens it in a new tab
  primaryAction: string;          // label for Continue button, e.g. "I published it" / "Continue"
}

export interface JobStep {
  id: number; jobId: string; seq: number; key: string; label: string; state: StepState;
  message: string | null; screenshotUrl: string | null; startedAt: string | null; finishedAt: string | null;
}

export interface Job {
  id: string;
  type: JobType;
  marketplaceId: MarketplaceId | null;
  listingId: string | null;
  state: JobState;
  needsUser: NeedsUserRequest | null;
  errorCode: string | null;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  attempt: number;
  parentJobId: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  steps?: JobStep[];
  listingTitle?: string;          // denormalized for Activity drawer
}

export interface LogEntry {
  id: number; ts: string; level: 'debug' | 'info' | 'warn' | 'error'; scope: string; message: string;
  listingId: string | null; jobId: string | null; marketplaceId: MarketplaceId | null; data: unknown;
}

export interface MarketplacePrefs {
  enabled: boolean;
  autoSubmit: boolean;            // app clicks final Publish/Delete itself; forced false for facebook
  priceAdjustPercent: number;     // e.g. 10 → +10% (rounded per §5.3); default 0
  dailyLimit: number;             // max publish jobs per local calendar day
}

export interface Settings {
  shippingDefaults: ShippingInfo;
  descriptionFooter: string;
  defaultMarketplaces: MarketplaceId[];
  rememberLastMarketplaces: boolean;
  marketplaces: Record<MarketplaceId, MarketplacePrefs>;
  browser: { channel: 'chrome' | 'chromium'; slowMoMs: number; closeIdleMinutes: number };
  ebay: {
    fulfillmentPolicyId: string | null; paymentPolicyId: string | null; returnPolicyId: string | null;
    postalCode: string; dispatchTimeDays: number;
  };
  ai: {
    enabled: boolean;
    provider: 'ollama' | 'openai_compatible' | 'anthropic';
    baseUrl: string;              // ollama default http://127.0.0.1:11434 ; openai-compatible e.g. http://127.0.0.1:1234/v1
    textModel: string;            // default 'gemma3:4b'
    visionModel: string;          // default 'gemma3:4b'
  };
  statusChecks: { ebayPollingEnabled: boolean; ebayIntervalMinutes: number };
}

export interface MarketplaceInfo {
  id: MarketplaceId;
  name: string;
  kind: 'browser' | 'api' | 'manual';
  capabilities: MarketplaceCapabilities;
  connection: { status: 'unknown' | 'connected' | 'logged_out' | 'not_configured'; accountName: string | null; checkedAt: string | null; message: string | null };
  prefs: MarketplacePrefs;
  urls: { home: string; sell: string };
  dataFields: DataFieldDef[];     // DataFieldDef is defined in 05 §1 and lives in this file
}

export interface MarketplaceCapabilities {
  publish: 'auto' | 'assisted' | 'manual';
  update: 'auto' | 'assisted' | 'manual' | 'none';
  deactivate: 'auto' | 'assisted' | 'manual';
  statusCheck: 'api' | 'browser' | 'none';
  import: 'api' | 'browser' | 'url' | 'none';
  autoSubmitAllowed: boolean;
  maxPhotos: number;
  titleMaxLength: number | null;  // null = marketplace has no title field
  descriptionMaxLength: number;
  minPriceCents: number;
  maxPriceCents: number | null;
  requires: Array<'title' | 'description' | 'price' | 'condition' | 'category' | 'brand' | 'size' | 'shippingWeight' | 'msrp' | 'colors'>;
}
```

### 5.2 Zod schemas (`schemas.ts`)

Use zod for every request body. Required exports:

```ts
export const conditionSchema = z.enum(CONDITIONS);
export const marketplaceIdSchema = z.enum(MARKETPLACE_IDS);
export const colorIdSchema = z.enum(COLOR_IDS as [ColorId, ...ColorId[]]);
export const measurementsSchema = z.object({ chestIn: z.number().positive().max(200).optional(), /* … every Measurements key the same way */ }).strict();
export const shippingSchema = z.object({
  weightOz: z.number().positive().max(2400).nullable(),
  lengthIn: z.number().positive().max(200).nullable(),
  widthIn: z.number().positive().max(200).nullable(),
  heightIn: z.number().positive().max(200).nullable(),
  whoPays: z.enum(['buyer', 'seller']),
});
export const listingPatchSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(10_000),
  priceCents: z.number().int().min(0).max(10_000_000).nullable(),
  msrpCents: z.number().int().min(0).max(10_000_000).nullable(),
  costCents: z.number().int().min(0).max(10_000_000).nullable(),
  condition: conditionSchema.nullable(),
  conditionNotes: z.string().max(2000),
  categoryId: z.string().refine(isSelectableCategory, 'Unknown category').nullable(),
  brand: z.string().max(100),
  model: z.string().max(100),
  size: z.string().max(40),
  colors: z.array(colorIdSchema).max(MAX_COLORS),
  material: z.string().max(100),
  quantity: z.number().int().min(1).max(999),
  measurements: measurementsSchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  shipping: shippingSchema,
  notes: z.string().max(10_000),
}).partial().strict();
export const listingCreateSchema = listingPatchSchema; // all optional; server fills defaults
export const marketplaceTargetsSchema = z.object({ marketplaceIds: z.array(marketplaceIdSchema) });
export const marketplaceListingPatchSchema = z.object({
  titleOverride: z.string().max(200).nullable(),
  descriptionOverride: z.string().max(10_000).nullable(),
  priceOverrideCents: z.number().int().min(0).max(10_000_000).nullable(),
  data: z.record(z.string(), z.unknown()),
}).partial().strict();
export const crosslistSchema = z.object({ marketplaceIds: z.array(marketplaceIdSchema).min(1) });
export const markListedSchema = z.object({ url: z.string().url().nullable().optional(), remoteId: z.string().max(200).nullable().optional() });
export const markSoldSchema = z.object({
  marketplaceId: z.union([marketplaceIdSchema, z.literal('elsewhere')]),
  soldPriceCents: z.number().int().min(0).nullable().optional(),
  soldAt: z.string().datetime().optional(),
  deactivateMarketplaceIds: z.array(marketplaceIdSchema).default([]),
});
export const continueJobSchema = z.object({ url: z.string().url().nullable().optional() });
export const photoOrderSchema = z.object({ photoIds: z.array(z.string()).min(1) });
export const photoEditSchema = z.object({
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) }).nullable().optional(),
}).strict();
export const settingsSchema = /* full Settings object schema mirroring the Settings type; every field required */;
```

`PUT /api/settings` always receives the **full** Settings object (the UI loads it, edits it, sends it back), so no partial/deep-partial schema is needed. Constraints: `priceAdjustPercent` −50..100, `dailyLimit` 1..200, `slowMoMs` 0..2000, `closeIdleMinutes` 1..240, `ebayIntervalMinutes` 15..1440, `dispatchTimeDays` 0..30, `postalCode` matches `/^\d{5}$/` or is `''`, `descriptionFooter` ≤ 500 chars.

### 5.3 `src/shared/money.ts`

```ts
/** "$65", "65", "65.5", "1,200.00", " 65.00 " → cents. Returns null for empty or invalid. Rejects negatives and >2 decimals. */
export function parsePriceToCents(input: string): number | null;
/** 6500 → "$65.00"; null → "" */
export function formatCents(cents: number | null): string;
/** 6500 → "$65", 6550 → "$65.50" */
export function formatCentsShort(cents: number | null): string;
/** Apply percent adjustment and round to whole dollars: applyPriceAdjust(6500, 10) → 7200 (71.5 → round half up → 72). 0% returns input unchanged. */
export function applyPriceAdjust(cents: number, percent: number): number;
```

### 5.4 `src/shared/text.ts`

```ts
/** lowercase, NFKD, strip diacritics, replace non-alphanumerics with space, collapse spaces, trim. */
export function normalizeText(s: string): string;
/** Truncate to max chars at the last word boundary ≤ max; never cut mid-word unless a single word exceeds max; no ellipsis. */
export function truncateAtWord(s: string, max: number): string;
export function tokenSet(s: string): Set<string>;      // normalizeText then split on space, drop tokens of length 1
export function jaccard(a: Set<string>, b: Set<string>): number; // 0..1, both empty → 0
```

## 6. Database (`src/server/db/schema.ts`)

Drizzle `sqlite-core`. Timestamps are ISO-8601 UTC strings (`new Date().toISOString()`). JSON columns use `text(..., { mode: 'json' })`. Booleans use `integer(..., { mode: 'boolean' })`.

```ts
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const listings = sqliteTable('listings', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull(),
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  priceCents: integer('price_cents'),
  msrpCents: integer('msrp_cents'),
  costCents: integer('cost_cents'),
  currency: text('currency').notNull().default('USD'),
  condition: text('condition'),
  conditionNotes: text('condition_notes').notNull().default(''),
  categoryId: text('category_id'),
  brand: text('brand').notNull().default(''),
  model: text('model').notNull().default(''),
  size: text('size').notNull().default(''),
  colors: text('colors', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  material: text('material').notNull().default(''),
  quantity: integer('quantity').notNull().default(1),
  measurements: text('measurements', { mode: 'json' }).$type<Record<string, number>>().notNull().default(sql`'{}'`),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  shipping: text('shipping', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('draft'),
  source: text('source').notNull().default('created'),
  soldAt: text('sold_at'),
  soldPriceCents: integer('sold_price_cents'),
  soldMarketplaceId: text('sold_marketplace_id'),
  saleDetectedMarketplaceId: text('sale_detected_marketplace_id'),
  saleDetectedAt: text('sale_detected_at'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('listings_sku_uq').on(t.sku),
  index('listings_status_idx').on(t.status),
  index('listings_updated_idx').on(t.updatedAt),
]);

export const photos = sqliteTable('photos', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  originalFilename: text('original_filename').notNull(),
  storedFilename: text('stored_filename').notNull(),   // e.g. "k3j2h1g0f9e8.heic" in original/
  mimeType: text('mime_type').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  dhash: text('dhash'),
  rotation: integer('rotation').notNull().default(0),
  crop: text('crop', { mode: 'json' }).$type<{ x: number; y: number; width: number; height: number } | null>(),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
}, (t) => [index('photos_listing_idx').on(t.listingId, t.position)]);

export const marketplaceListings = sqliteTable('marketplace_listings', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  marketplaceId: text('marketplace_id').notNull(),
  status: text('status').notNull().default('not_listed'),
  remoteId: text('remote_id'),
  url: text('url'),
  titleOverride: text('title_override'),
  descriptionOverride: text('description_override'),
  priceOverrideCents: integer('price_override_cents'),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(true),
  lastError: text('last_error'),
  lastErrorCode: text('last_error_code'),
  listedAt: text('listed_at'),
  endedAt: text('ended_at'),
  lastSyncedAt: text('last_synced_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('ml_listing_marketplace_uq').on(t.listingId, t.marketplaceId),
  index('ml_remote_idx').on(t.marketplaceId, t.remoteId),
]);

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  marketplaceId: text('marketplace_id'),
  listingId: text('listing_id').references(() => listings.id, { onDelete: 'cascade' }),
  state: text('state').notNull().default('NOT_STARTED'),
  needsUser: text('needs_user', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  input: text('input', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  result: text('result', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  attempt: integer('attempt').notNull().default(1),
  parentJobId: text('parent_job_id'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
}, (t) => [index('jobs_state_idx').on(t.state), index('jobs_listing_idx').on(t.listingId)]);

export const jobSteps = sqliteTable('job_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  state: text('state').notNull().default('pending'),
  message: text('message'),
  screenshotPath: text('screenshot_path'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
}, (t) => [index('job_steps_job_idx').on(t.jobId, t.seq)]);

export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: text('ts').notNull(),
  level: text('level').notNull(),
  scope: text('scope').notNull(),
  message: text('message').notNull(),
  listingId: text('listing_id'),
  jobId: text('job_id'),
  marketplaceId: text('marketplace_id'),
  data: text('data', { mode: 'json' }),
}, (t) => [index('logs_ts_idx').on(t.ts)]);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

export const marketplaceConnections = sqliteTable('marketplace_connections', {
  marketplaceId: text('marketplace_id').primaryKey(),
  status: text('status').notNull().default('unknown'),
  accountName: text('account_name'),
  checkedAt: text('checked_at'),
  message: text('message'),
});

// Phase 4
export const importBatches = sqliteTable('import_batches', {
  id: text('id').primaryKey(),
  marketplaceId: text('marketplace_id').notNull(),
  method: text('method').notNull(),          // 'api' | 'shop_page' | 'urls' | 'backup'
  state: text('state').notNull(),            // 'scanning' | 'ready' | 'fetching' | 'review' | 'done' | 'failed'
  createdAt: text('created_at').notNull(),
  finishedAt: text('finished_at'),
});

export const importItems = sqliteTable('import_items', {
  id: text('id').primaryKey(),
  batchId: text('batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
  marketplaceId: text('marketplace_id').notNull(),
  remoteId: text('remote_id'),
  url: text('url'),
  title: text('title').notNull().default(''),
  thumbUrl: text('thumb_url'),
  state: text('state').notNull().default('discovered'), // discovered|selected|fetched|imported|merged|skipped|failed
  raw: text('raw', { mode: 'json' }),
  mapped: text('mapped', { mode: 'json' }),
  photoPaths: text('photo_paths', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  duplicates: text('duplicates', { mode: 'json' }).$type<Array<{ listingId: string; score: number; reasons: string[] }>>().notNull().default(sql`'[]'`),
  existingListingId: text('existing_listing_id'),   // set when remoteId already linked
  resultListingId: text('result_listing_id'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
}, (t) => [index('import_items_batch_idx').on(t.batchId)]);
```

All tables are created by the first generated migration (`npm run db:generate` after writing the schema; commit `drizzle/`). Phase 4 tables are included from the start to avoid a second migration early, but are unused until M27.

## 7. DB client (`src/server/db/client.ts`, `migrate.ts`)

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function openDb(file: string): Db {
  const sqlite = new Database(file);            // ':memory:' supported for tests
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema }) as Db;
}
```

`migrate.ts`: `export function runMigrations(db: Db) { migrate(db, { migrationsFolder: path.resolve(<repo root>, 'drizzle') }); }` using `drizzle-orm/better-sqlite3/migrator`. Resolve the repo root from `import.meta.url` (two levels up from `src/server/db`).

## 8. Status rules (`src/server/services/listingStatus.ts`)

Implement `computeListingStatus(listing, marketplaceListings, canonicalIssues): ListingStatus` and `computeNeedsAttention(listing, marketplaceListings, jobs): boolean`, and `recomputeListingStatus(db, listingId)` which loads data, computes, and persists `status` (and emits `listing.updated`).

`computeListingStatus`:

1. `archivedAt` set → `'archived'`.
2. `soldAt` set → `'sold'`.
3. `targets` = marketplace listings with status ≠ `'ended'`. `active` = those with status `'active'`.
4. If `active.length === 0`: return `'ready'` if `canonicalIssues` has no `error`, else `'draft'`.
5. If `active.length < targets.length` → `'partially_listed'`.
6. Else → `'listed'`.

`computeNeedsAttention` is true when **any** of:
- a job for this listing is in `NEEDS_USER`, or the most recent job per marketplace is `FAILED`;
- any marketplace listing has status `'error'`;
- `saleDetectedMarketplaceId` is set;
- listing is `'sold'` and any marketplace listing is still `'active'`.

Call `recomputeListingStatus` after every change to a listing, its marketplace listings, or its jobs.

## 9. SKU allocation

`settings` row `sku_counter` holds `{ next: number }` (starts at 1). `allocateSku(db)` runs in a transaction: read, format `CL-` + `String(next).padStart(5, '0')`, write `next + 1`. Imported listings also receive SKUs.

## 10. Default values for a new listing

`title ''`, `description ''`, `priceCents null`, `condition null`, `categoryId null`, `colors []`, `quantity 1`, `measurements {}`, `tags []`, `shipping = settings.shippingDefaults` (copied), `status 'draft'`, `source 'created'`.
