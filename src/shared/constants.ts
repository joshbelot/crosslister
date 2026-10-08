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
