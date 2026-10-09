PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_event_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`source_id` text NOT NULL,
	`volume` text,
	`page` text,
	`section` text,
	`note` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_event_sources`("id", "event_id", "source_id", "volume", "page", "note") SELECT "id", "event_id", "source_id", "volume", "page", "note" FROM `event_sources`;--> statement-breakpoint
DROP TABLE `event_sources`;--> statement-breakpoint
ALTER TABLE `__new_event_sources` RENAME TO `event_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `event_sources_event` ON `event_sources` (`event_id`);