CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`label` text NOT NULL,
	`role` text NOT NULL,
	`owner` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`role` text,
	`tool` text NOT NULL,
	`ok` integer NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ayah_translations` (
	`ayah_id` text NOT NULL,
	`lang` text NOT NULL,
	`text` text NOT NULL,
	`translation_source` text NOT NULL,
	`translation_license` text NOT NULL,
	PRIMARY KEY(`ayah_id`, `lang`),
	FOREIGN KEY (`ayah_id`) REFERENCES `ayat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ayat` (
	`id` text PRIMARY KEY NOT NULL,
	`surah` integer NOT NULL,
	`ayah` integer NOT NULL,
	`arabic_text` text NOT NULL,
	`arabic_source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ayat_ref` ON `ayat` (`surah`,`ayah`);--> statement-breakpoint
CREATE TABLE `content_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`lang` text NOT NULL,
	`name` text NOT NULL,
	`license` text NOT NULL,
	`url` text,
	`sha256` text
);
--> statement-breakpoint
CREATE TABLE `era_translations` (
	`era_id` text NOT NULL,
	`lang` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	PRIMARY KEY(`era_id`, `lang`),
	FOREIGN KEY (`era_id`) REFERENCES `eras`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `eras` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`order_index` integer NOT NULL,
	`start_hijri` integer,
	`end_hijri` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eras_slug_unique` ON `eras` (`slug`);--> statement-breakpoint
CREATE TABLE `event_ayat` (
	`event_id` text NOT NULL,
	`ayah_id` text NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`event_id`, `ayah_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ayah_id`) REFERENCES `ayat`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `event_hadith` (
	`event_id` text NOT NULL,
	`hadith_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `hadith_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hadith_id`) REFERENCES `hadith_refs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `event_people` (
	`event_id` text NOT NULL,
	`person_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `person_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `event_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`source_id` text NOT NULL,
	`volume` text,
	`page` text NOT NULL,
	`note` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_sources_event` ON `event_sources` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_translations` (
	`event_id` text NOT NULL,
	`lang` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`key_details` text DEFAULT '[]' NOT NULL,
	`lessons` text DEFAULT '[]' NOT NULL,
	`dispute_note` text,
	`my_reflection` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`event_id`, `lang`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`era_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`hijri_year` integer,
	`gregorian_approx` integer,
	`prophet_age` integer,
	`place_id` text,
	`route_id` text,
	`certainty` text DEFAULT 'agreed' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`needs_verification` integer DEFAULT false NOT NULL,
	`published_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`era_id`) REFERENCES `eras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_slug_unique` ON `events` (`slug`);--> statement-breakpoint
CREATE INDEX `events_status_order` ON `events` (`status`,`order_index`);--> statement-breakpoint
CREATE INDEX `events_era` ON `events` (`era_id`);--> statement-breakpoint
CREATE TABLE `hadith_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`collection` text NOT NULL,
	`number` text NOT NULL,
	`grading` text NOT NULL,
	`grading_by` text,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hadith_ref` ON `hadith_refs` (`collection`,`number`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`event_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_r2_key_unique` ON `media` (`r2_key`);--> statement-breakpoint
CREATE TABLE `media_alt` (
	`media_id` text NOT NULL,
	`lang` text NOT NULL,
	`alt` text NOT NULL,
	PRIMARY KEY(`media_id`, `lang`),
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_slug_unique` ON `people` (`slug`);--> statement-breakpoint
CREATE TABLE `person_translations` (
	`person_id` text NOT NULL,
	`lang` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`person_id`, `lang`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `place_translations` (
	`place_id` text NOT NULL,
	`lang` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`place_id`, `lang`),
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`type` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`verified` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `places_slug_unique` ON `places` (`slug`);--> statement-breakpoint
CREATE TABLE `preview_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recall_question_translations` (
	`question_id` text NOT NULL,
	`lang` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`distractors` text NOT NULL,
	PRIMARY KEY(`question_id`, `lang`),
	FOREIGN KEY (`question_id`) REFERENCES `recall_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recall_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recall_event` ON `recall_questions` (`event_id`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`actor` text NOT NULL,
	`reverted_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `revisions_entity` ON `revisions` (`entity`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `route_translations` (
	`route_id` text NOT NULL,
	`lang` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`route_id`, `lang`),
	FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `routes` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`geojson` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routes_slug_unique` ON `routes` (`slug`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`book` text NOT NULL,
	`author` text NOT NULL,
	`edition` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_slug_unique` ON `sources` (`slug`);