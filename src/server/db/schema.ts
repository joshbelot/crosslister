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

export type ListingRow = typeof listings.$inferSelect;
export type PhotoRow = typeof photos.$inferSelect;
export type MarketplaceListingRow = typeof marketplaceListings.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobStepRow = typeof jobSteps.$inferSelect;
export type LogRow = typeof logs.$inferSelect;
