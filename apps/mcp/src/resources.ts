import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { CONTENT_GUIDELINES, SUPPORTED_LANGS, ALLOWED_MEDIA_KINDS, MEDIA_PLACEMENTS, DEFAULT_LANG } from '@seerah/content'
import type { ToolCtx } from './tools/kit'
import { outlineMarkdown, timelineOutline } from './tools/read'

const SCHEMA_REFERENCE = `# Data model (D1) and conventions

- **eras** (slug, order) → era_translations(lang, title, summary)
- **events** (slug, era, order_index, hijri_year, gregorian_approx, prophet_age, route, certainty agreed|disputed, status draft|published|archived, needs_verification)
  - **event_translations** (lang, title, summary, key_details[], lessons[], dispute_note, my_reflection, status draft|published). Languages: ${Object.keys(SUPPORTED_LANGS).join(', ')} (default ${DEFAULT_LANG}).
  - **event_places** (event, place, role primary|related|route_start|route_end, order): exactly ONE primary (the map flies to it); related places are secondary markers; with several places the map fits them all. Tools: set_primary_place, add_event_place, remove_event_place. (events.place_id is a deprecated mirror of the primary.)
  - sources via **event_sources** (source slug, volume, page, note); ayat via **event_ayat** (refs only; text filled by server); hadith via **event_hadith** (collection, number, grading); **recall_questions** (+translations: question, answer, distractors[]); **media** (kind: ${ALLOWED_MEDIA_KINDS.join(' | ')}; placement ${MEDIA_PLACEMENTS.join(' | ')}; after_index; order; credit, licence, author, source_url; alt + caption per language; responsive webp copies). **event_ayat** has the same placement / after_index / order, plus **event_ayat_notes** (one short sentence per language above the ayah card).
- **places** (slug, type region|city|site, parent_place (a site's city), zoom override, lat, lng, verified). Default map zoom: region ≈ 6, city ≈ 12, site ≈ 17 (capped where only coarse tiles exist). Sites such as the Kaaba (masjid-al-haram) and the Zamzam well (zamzam) belong to Makkah and **routes** (GeoJSON LineString, [lng, lat]).
- **revisions** record before/after for every change; **audit_log** records every tool call.

Conventions
- Slugs: lowercase ascii-with-hyphens. Hijri years before the Hijrah are negative; no year 0. Gregorian years 500-640; prophet_age 0-63.
- Coordinates in create_place are (lat, lng); in GeoJSON they are [lng, lat].
- Ayat and pictures share ONE placement model (slots: hero, in_summary after paragraph N, after_summary, in_key_details after N, in_lessons after N, before_lessons, end, gallery for pictures only). Call get_event_layout before placing anything. A picture's or ayah's position is its structured placement; never write image markers or URLs into text fields.
- Writes return a revision_id. revert_revision undoes it.
- Editors can create and edit drafts; only the owner publishes, unpublishes and verifies places.
- A publishable event has: a source citation (volume/page), a certainty flag (disputed ⇒ dispute_note), a default-language title and summary.
`

export function registerResources(server: McpServer, ctx: ToolCtx) {
  server.registerResource('content-guidelines', 'seerah://content-guidelines', { title: 'Content guidelines', description: 'Rules and writing style every AI must follow', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: CONTENT_GUIDELINES }] }))
  server.registerResource('schema-reference', 'seerah://schema', { title: 'Schema reference', description: 'Data model and conventions', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: SCHEMA_REFERENCE }] }))
  server.registerResource('timeline-outline', 'seerah://timeline/outline', { title: 'Current timeline outline', description: 'All events in order, grouped by era', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: outlineMarkdown(await timelineOutline(ctx, DEFAULT_LANG)) }] }))
}

export function registerPrompts(server: McpServer) {
  server.registerPrompt('add_event_from_my_notes', {
    title: 'Add event from my notes',
    description: 'Turn the owner\'s rough notes into a verified draft event with sources, ayat, place and a preview link.',
    argsSchema: z.object({ notes: z.string().min(10).describe('The owner\'s notes about the event, in any language.') }),
  }, ({ notes }) => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `Read the seerah://content-guidelines resource first and follow it strictly. Then help me add an event to the Seerah timeline from these notes:

<notes>
${notes}
</notes>

Do these steps in order, and stop to ask me whenever something is missing or uncertain. Never invent facts, page numbers, hadith numbers or gradings.

1. DUPLICATES: call search_events and get_timeline_outline with the key names/terms. If a similar event exists, show it and ask whether to update it instead.
2. STRUCTURE: restructure my notes into a Bangla title, a short summary, key_details and lessons, plus hijri year, approximate Gregorian year and the Prophet's ﷺ age if I gave them. Show it to me and fix what I correct. Decide era and where it belongs in the order; if the date is uncertain, propose certainty "disputed" with a dispute_note.
3. SOURCE: ask me for the source book, volume and page (and edition). If I don't have it, say the event cannot be published without it, but you may still create the draft.
4. AYAT: suggest relevant surah:ayah REFERENCES only (never write Arabic). Call attach_ayah for each reference I accept, then show me the Arabic and Bangla the server returned and ask me to confirm each; detach_ayah any I reject. Ask me for hadith collection/number/grading if I want hadith.
5. PLACE: use find_place; if missing use create_place (type region|city|site, lat then lng, parent_place_slug for a site's city). Be specific: the Zamzam well is a site, not just "Makkah". Call set_primary_place for the ONE primary place, add_event_place for related places. For a journey, create_route (GeoJSON [lng, lat]) and attach it with update_event.
6. DRAFT: call create_event_draft, then create_source/add_source_citation, set_event_order, add_recall_questions (3 questions from facts stated in the event).
7. AYAT AND PICTURES: use the place_ayat_and_media prompt (get_event_layout first). PREVIEW: call preview_event and give me the link. Tell me what still blocks publishing (get_event → publish_blockers). Do not publish; only I do that.` },
    }],
  }))

  server.registerPrompt('place_ayat_and_media', {
    title: 'Place ayat and media',
    description: 'Look at the event page as numbered slots, propose the best slot for each ayah or picture with a reason, wait for the owner, then place them and return a preview link.',
    argsSchema: z.object({ event_slug: z.string().min(2).describe('Slug of the event.'), items: z.string().min(3).describe('The ayat (surah:ayah) and/or pictures (where they come from) to place, in any language.') }),
  }, ({ event_slug, items }) => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `Read the seerah://content-guidelines resource first. Then place these into the event "${event_slug}":

<items>
${items}
</items>

Steps, in order:
1. LAYOUT: call get_event_layout for the event (use the page language). Read every numbered summary paragraph, key detail and lesson, and see what is already placed.
2. PROPOSE: for EACH ayah or picture choose the most relevant slot: the paragraph, key detail or lesson it directly supports (placement + after_index), or hero / after_summary / before_lessons / end / gallery when no single element fits. Give a one-line reason per item, in the page language, in correct standard form (proper Bangla, never Banglish; honorifics respected). For ayat also propose a short placement_note (one sentence). Do not dump everything in one place. If the text has no suitable slot, say so and suggest editing the text first.
3. WAIT: show the owner the proposal as a short list and wait for confirmation or changes. Do not save anything yet.
4. ATTACH: for ayat call attach_ayah (reference only, never write Arabic) and show the owner the Arabic and translation the server returned; for pictures use upload_media with media_url (Wikimedia Commons, free licences only) or create_upload_link / create_upload_url for the owner's own files. Use set_ayah_placement / set_media_placement to adjust. Check needs_placement_review in the result.
5. PREVIEW: call preview_event and give the owner the link. Do not publish; only the owner does.` },
    }],
  }))
}
