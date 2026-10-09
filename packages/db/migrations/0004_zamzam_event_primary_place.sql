-- Content change, requested by the owner: the Zamzam event's primary place is the Zamzam site (it was Makkah).
-- Makkah stays linked as a related place. Only touches the event with this slug, only while its primary is still
-- Makkah (so re-running, or an owner's later choice, is never overwritten), and records itself in audit_log.
-- NOTE: year-of-the-elephant is deliberately NOT changed here (the owner decides).
UPDATE event_places SET role = 'related', order_index = 1
WHERE role = 'primary'
  AND place_id = (SELECT id FROM places WHERE slug = 'makkah')
  AND event_id = (SELECT id FROM events WHERE slug = 'abdul-muttalib-rediscovers-zamzam')
  AND EXISTS (SELECT 1 FROM places WHERE slug = 'zamzam');
--> statement-breakpoint
INSERT OR IGNORE INTO event_places (event_id, place_id, role, order_index)
SELECT e.id, p.id, 'primary', 0
FROM events e, places p
WHERE e.slug = 'abdul-muttalib-rediscovers-zamzam' AND p.slug = 'zamzam'
  AND NOT EXISTS (SELECT 1 FROM event_places x WHERE x.event_id = e.id AND x.role = 'primary');
--> statement-breakpoint
UPDATE events SET place_id = (SELECT id FROM places WHERE slug = 'zamzam'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE slug = 'abdul-muttalib-rediscovers-zamzam'
  AND EXISTS (SELECT 1 FROM event_places x WHERE x.event_id = events.id AND x.role = 'primary' AND x.place_id = (SELECT id FROM places WHERE slug = 'zamzam'))
  AND place_id IS NOT (SELECT id FROM places WHERE slug = 'zamzam');
--> statement-breakpoint
INSERT INTO audit_log (actor, role, tool, ok, detail)
SELECT 'migration', NULL, 'migration.0004_zamzam_event_primary_place', 1, '{"event":"abdul-muttalib-rediscovers-zamzam","primary":"zamzam","was":"makkah (kept as related)"}'
WHERE EXISTS (SELECT 1 FROM event_places x JOIN events e ON e.id = x.event_id JOIN places p ON p.id = x.place_id
              WHERE e.slug = 'abdul-muttalib-rediscovers-zamzam' AND x.role = 'primary' AND p.slug = 'zamzam')
  AND NOT EXISTS (SELECT 1 FROM audit_log WHERE tool = 'migration.0004_zamzam_event_primary_place');
