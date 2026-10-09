-- Data migration for the shared placement model (idempotent).

-- 1. Pictures: "after key detail N" becomes the general "after_index" (only in_key_details pictures ever had a value).
UPDATE media SET after_index = after_key_detail_index WHERE after_key_detail_index IS NOT NULL AND after_index IS NULL;
--> statement-breakpoint

-- 2. Ayat used to render right under the title block, before the summary, after any hero picture. That is exactly the `hero` slot,
--    so existing rows keep their look: placement = 'hero' (the column default) and an order above any picture's (pictures start at 0).
UPDATE event_ayat SET placement = 'hero', order_index = order_index + 1000 WHERE order_index < 1000;
