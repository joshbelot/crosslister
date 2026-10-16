CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text,
	`marketplace_id` text NOT NULL,
	`sold_at` text NOT NULL,
	`title` text NOT NULL,
	`sku` text NOT NULL,
	`sale_price_cents` integer,
	`shipping_charged_cents` integer,
	`marketplace_fees_cents` integer,
	`shipping_cost_cents` integer,
	`other_costs_cents` integer,
	`item_cost_cents` integer,
	`buyer` text DEFAULT '' NOT NULL,
	`order_url` text,
	`notes` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sales_sold_at_idx` ON `sales` (`sold_at`);--> statement-breakpoint
CREATE INDEX `sales_listing_idx` ON `sales` (`listing_id`);