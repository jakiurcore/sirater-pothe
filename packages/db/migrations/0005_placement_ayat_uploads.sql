CREATE TABLE `event_ayat_notes` (
	`event_id` text NOT NULL,
	`ayah_id` text NOT NULL,
	`lang` text NOT NULL,
	`note` text NOT NULL,
	PRIMARY KEY(`event_id`, `ayah_id`, `lang`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ayah_id`) REFERENCES `ayat`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`total_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`chunk_size` integer NOT NULL,
	`meta` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `upload_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`created_by` text NOT NULL,
	`event_id` text,
	`kind` text NOT NULL,
	`placement` text NOT NULL,
	`after_index` integer,
	`order_index` integer,
	`alt` text NOT NULL,
	`caption` text,
	`credit` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`media_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `event_ayat` ADD `placement` text DEFAULT 'hero' NOT NULL;--> statement-breakpoint
ALTER TABLE `event_ayat` ADD `after_index` integer;--> statement-breakpoint
ALTER TABLE `media` ADD `after_index` integer;--> statement-breakpoint
ALTER TABLE `media` ADD `license` text;--> statement-breakpoint
ALTER TABLE `media` ADD `author` text;--> statement-breakpoint
ALTER TABLE `media` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `media` ADD `variants` text;--> statement-breakpoint
ALTER TABLE `media` ADD `sha256` text;