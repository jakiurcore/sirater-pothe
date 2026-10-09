-- Data migration for 0002 (idempotent: safe to run on a database that already has some of this).

-- 1. Every existing events.place_id becomes the event's primary row in event_places.
--    events.place_id stays (deprecated mirror) so readers that predate the join table keep working during a deploy.
INSERT OR IGNORE INTO event_places (event_id, place_id, role, order_index)
SELECT id, place_id, 'primary', 0 FROM events WHERE place_id IS NOT NULL;
--> statement-breakpoint

-- 2. Place types are now region | city | site. Legacy kinds become sites; wide ones keep a sensible zoom
--    (a site defaults to zoom 17, far too tight for a battlefield or a plain).
UPDATE places SET zoom_override = CASE type
    WHEN 'cave' THEN 15 WHEN 'mountain' THEN 14 WHEN 'plain' THEN 13 WHEN 'valley' THEN 13 WHEN 'battlefield' THEN 13
  END
WHERE type IN ('cave', 'mountain', 'plain', 'valley', 'battlefield') AND zoom_override IS NULL;
--> statement-breakpoint
UPDATE places SET type = 'site' WHERE type NOT IN ('region', 'city', 'site');
--> statement-breakpoint

-- 3. Sites inside Makkah (only where Makkah exists; fresh databases get them from the seed). Both are UNVERIFIED.
--    Kaaba: OpenStreetMap way 103914569 (centroid 21.4225079, 39.826189).
--    Zamzam: Wikipedia "Zamzam Well" gives 21.4220, 39.8260 (3 decimals, about 100 m) but its text says "20 m east of the Kaaba":
--    the two disagree, so the owner must verify it (verify_place).
INSERT OR IGNORE INTO places (id, slug, type, lat, lng, verified, parent_place_id)
SELECT 'seed-place-masjid-al-haram', 'masjid-al-haram', 'site', 21.4225079, 39.826189, 0, id FROM places WHERE slug = 'makkah';
--> statement-breakpoint
INSERT OR IGNORE INTO places (id, slug, type, lat, lng, verified, parent_place_id)
SELECT 'seed-place-zamzam', 'zamzam', 'site', 21.422, 39.826, 0, id FROM places WHERE slug = 'makkah';
--> statement-breakpoint
INSERT OR IGNORE INTO place_translations (place_id, lang, name)
SELECT id, 'bn', 'মাসজিদুল হারাম (কাবা)' FROM places WHERE slug = 'masjid-al-haram';
--> statement-breakpoint
INSERT OR IGNORE INTO place_translations (place_id, lang, name)
SELECT id, 'en', 'Masjid al-Haram (the Kaaba)' FROM places WHERE slug = 'masjid-al-haram';
--> statement-breakpoint
INSERT OR IGNORE INTO place_translations (place_id, lang, name)
SELECT id, 'ar', 'المسجد الحرام (الكعبة)' FROM places WHERE slug = 'masjid-al-haram';
--> statement-breakpoint
INSERT OR IGNORE INTO place_translations (place_id, lang, name)
SELECT id, 'bn', 'জমজম কূপ' FROM places WHERE slug = 'zamzam';
--> statement-breakpoint
INSERT OR IGNORE INTO place_translations (place_id, lang, name)
SELECT id, 'en', 'Zamzam well' FROM places WHERE slug = 'zamzam';
--> statement-breakpoint
INSERT OR IGNORE INTO place_translations (place_id, lang, name)
SELECT id, 'ar', 'بئر زمزم' FROM places WHERE slug = 'zamzam';
