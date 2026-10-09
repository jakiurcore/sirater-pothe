CREATE TABLE `event_places` (
	`event_id` text NOT NULL,
	`place_id` text NOT NULL,
	`role` text DEFAULT 'related' NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`event_id`, `place_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_places_one_primary` ON `event_places` (`event_id`) WHERE "event_places"."role" = 'primary';--> statement-breakpoint
CREATE INDEX `event_places_place` ON `event_places` (`place_id`);--> statement-breakpoint
ALTER TABLE `media` ADD `placement` text DEFAULT 'gallery' NOT NULL;--> statement-breakpoint
ALTER TABLE `media` ADD `after_key_detail_index` integer;--> statement-breakpoint
ALTER TABLE `media` ADD `order_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `media` ADD `credit` text;--> statement-breakpoint
ALTER TABLE `media` ADD `width` integer;--> statement-breakpoint
ALTER TABLE `media` ADD `height` integer;--> statement-breakpoint
CREATE INDEX `media_event` ON `media` (`event_id`);--> statement-breakpoint
ALTER TABLE `media_alt` ADD `caption` text;--> statement-breakpoint
ALTER TABLE `places` ADD `parent_place_id` text REFERENCES places(id);--> statement-breakpoint
ALTER TABLE `places` ADD `zoom_override` integer;