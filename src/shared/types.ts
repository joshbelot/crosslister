import type {
  Condition, JobState, JobType, ListingStatus, MarketplaceId, MarketplaceListingStatus, StepState,
} from './constants';
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
  activeJobs: Job[];             // non-terminal jobs for the listing
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
  priceAdjustPercent: number;     // e.g. 10 → +10% (rounded per money.ts); default 0
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

export interface DataFieldDef {
  key: string;                                  // key inside MarketplaceListing.data
  label: string;
  type: 'text' | 'textarea' | 'number' | 'money' | 'select' | 'tags' | 'boolean' | 'path' | 'ebay_category' | 'ebay_aspects';
  options?: Array<{ value: string; label: string }>; // for 'select'
  help?: string;
  maxItems?: number;                            // for 'tags'
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

export interface MarketplaceInfo {
  id: MarketplaceId;
  name: string;
  kind: 'browser' | 'api' | 'manual';
  capabilities: MarketplaceCapabilities;
  connection: { status: 'unknown' | 'connected' | 'logged_out' | 'not_configured'; accountName: string | null; checkedAt: string | null; message: string | null };
  prefs: MarketplacePrefs;
  urls: { home: string; sell: string };
  dataFields: DataFieldDef[];
}

export type AppEvent =
  | { type: 'job.updated'; job: Job }                       // any job field/state change (includes steps)
  | { type: 'listing.updated'; listingId: string }
  | { type: 'listing.deleted'; listingId: string }
  | { type: 'connection.updated'; marketplaceId: MarketplaceId }
  | { type: 'import.updated'; batchId: string }
  | { type: 'sale.detected'; listingId: string; marketplaceId: MarketplaceId }
  | { type: 'log'; entry: LogEntry };
