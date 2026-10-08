CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`marketplace_id` text NOT NULL,
	`method` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`marketplace_id` text NOT NULL,
	`remote_id` text,
	`url` text,
	`title` text DEFAULT '' NOT NULL,
	`thumb_url` text,
	`state` text DEFAULT 'discovered' NOT NULL,
	`raw` text,
	`mapped` text,
	`photo_paths` text DEFAULT '[]' NOT NULL,
	`duplicates` text DEFAULT '[]' NOT NULL,
	`existing_listing_id` text,
	`result_listing_id` text,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_items_batch_idx` ON `import_items` (`batch_id`);--> statement-breakpoint
CREATE TABLE `job_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`seq` integer NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`screenshot_path` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_steps_job_idx` ON `job_steps` (`job_id`,`seq`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`marketplace_id` text,
	`listing_id` text,
	`state` text DEFAULT 'NOT_STARTED' NOT NULL,
	`needs_user` text,
	`input` text,
	`result` text,
	`error_code` text,
	`error_message` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`parent_job_id` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_state_idx` ON `jobs` (`state`);--> statement-breakpoint
CREATE INDEX `jobs_listing_idx` ON `jobs` (`listing_id`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price_cents` integer,
	`msrp_cents` integer,
	`cost_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`condition` text,
	`condition_notes` text DEFAULT '' NOT NULL,
	`category_id` text,
	`brand` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	`colors` text DEFAULT '[]' NOT NULL,
	`material` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`measurements` text DEFAULT '{}' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`shipping` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`source` text DEFAULT 'created' NOT NULL,
	`sold_at` text,
	`sold_price_cents` integer,
	`sold_marketplace_id` text,
	`sale_detected_marketplace_id` text,
	`sale_detected_at` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_sku_uq` ON `listings` (`sku`);--> statement-breakpoint
CREATE INDEX `listings_status_idx` ON `listings` (`status`);--> statement-breakpoint
CREATE INDEX `listings_updated_idx` ON `listings` (`updated_at`);--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`level` text NOT NULL,
	`scope` text NOT NULL,
	`message` text NOT NULL,
	`listing_id` text,
	`job_id` text,
	`marketplace_id` text,
	`data` text
);
--> statement-breakpoint
CREATE INDEX `logs_ts_idx` ON `logs` (`ts`);--> statement-breakpoint
CREATE TABLE `marketplace_connections` (
	`marketplace_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`account_name` text,
	`checked_at` text,
	`message` text
);
--> statement-breakpoint
CREATE TABLE `marketplace_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`marketplace_id` text NOT NULL,
	`status` text DEFAULT 'not_listed' NOT NULL,
	`remote_id` text,
	`url` text,
	`title_override` text,
	`description_override` text,
	`price_override_cents` integer,
	`data` text DEFAULT '{}' NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	`last_error` text,
	`last_error_code` text,
	`listed_at` text,
	`ended_at` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ml_listing_marketplace_uq` ON `marketplace_listings` (`listing_id`,`marketplace_id`);--> statement-breakpoint
CREATE INDEX `ml_remote_idx` ON `marketplace_listings` (`marketplace_id`,`remote_id`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`position` integer NOT NULL,
	`original_filename` text NOT NULL,
	`stored_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`dhash` text,
	`rotation` integer DEFAULT 0 NOT NULL,
	`crop` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photos_listing_idx` ON `photos` (`listing_id`,`position`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
