import { z } from 'zod'
import { checkRef } from './quran'
import { addHonorific } from './honorific'
import { inArabiaBBox, ARABIA_BBOX, PLACE_TYPES, EVENT_PLACE_ROLES, MIN_ZOOM_OVERRIDE, MAX_ZOOM_OVERRIDE } from './geo'

// ───────────── primitives ─────────────
export { SUPPORTED_LANGS, DEFAULT_LANG, type Lang } from './langs'
import { SUPPORTED_LANGS, DEFAULT_LANG, type Lang } from './langs'
export const LangSchema = z.enum(Object.keys(SUPPORTED_LANGS) as [Lang, ...Lang[]])

export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase ascii words joined by hyphens, e.g. "first-revelation"')
  .max(80)

/** Human-written text. ﷺ is inserted after the Prophet's name when missing. */
const text = (max: number) => z.string().trim().min(1).max(max).transform(addHonorific)
const textList = (maxItems: number, maxLen: number) => z.array(text(maxLen)).max(maxItems)

export const CertaintySchema = z.enum(['agreed', 'disputed'])
export const StatusSchema = z.enum(['draft', 'published', 'archived'])
export const RoleSchema = z.enum(['owner', 'editor'])

// ───────────── time ─────────────
// Hijri years before the Hijrah are negative (e.g. birth ≈ -53). There is no year 0.
export const HijriYearSchema = z.number().int().min(-60).max(11).refine((n) => n !== 0, 'There is no Hijri year 0; use -1 for the year before the Hijrah and 1 for the Hijrah year.')
export const GregorianApproxSchema = z.number().int().min(500).max(640)
export const ProphetAgeSchema = z.number().int().min(0).max(63)

// ───────────── events ─────────────
export const EventTranslationSchema = z.object({
  lang: LangSchema,
  title: text(160),
  summary: text(1200),
  key_details: textList(15, 400).default([]),
  lessons: textList(10, 600).default([]),
  dispute_note: text(1500).nullish(),
  my_reflection: text(3000).nullish(),
})
export type EventTranslationInput = z.input<typeof EventTranslationSchema>

const EventBase = z.object({
  slug: SlugSchema,
  era_slug: SlugSchema,
  hijri_year: HijriYearSchema.nullish(),
  gregorian_approx: GregorianApproxSchema.nullish(),
  prophet_age: ProphetAgeSchema.nullish(),
  place_slug: SlugSchema.nullish(),
  route_slug: SlugSchema.nullish(),
  certainty: CertaintySchema.default('agreed'),
  translation: EventTranslationSchema,
})

export const refineDispute = <T extends { certainty?: string; dispute_note?: unknown }>(v: T, ctx: z.RefinementCtx, path: (string | number)[] = []) => {
  if (v.certainty === 'disputed' && !v.dispute_note)
    ctx.addIssue({ code: 'custom', path: [...path, 'dispute_note'], message: 'Certainty "disputed" requires dispute_note explaining the different positions.' })
}

export const CreateEventDraftSchema = EventBase.superRefine((v, ctx) => refineDispute({ certainty: v.certainty, dispute_note: v.translation.dispute_note }, ctx, ['translation']))

export const UpdateEventSchema = z.object({
  slug: SlugSchema,
  patch: z.object({
    era_slug: SlugSchema,
    hijri_year: HijriYearSchema.nullable(),
    gregorian_approx: GregorianApproxSchema.nullable(),
    prophet_age: ProphetAgeSchema.nullable(),
    place_slug: SlugSchema.nullable(),
    route_slug: SlugSchema.nullable(),
  }).partial().refine((p) => Object.keys(p).length > 0, 'patch must change at least one field'),
})

// ───────────── Qur'an: references only, never text ─────────────
export const AyahRefSchema = z
  .strictObject(
    { surah: z.number().int(), ayah: z.number().int(), ayahTo: z.number().int().optional() },
    { error: (iss) => iss.code === 'unrecognized_keys' ? "Only surah, ayah and optional ayahTo are accepted. Qur'an text is never accepted from clients; the server fills Arabic and translation from verified datasets." : undefined },
  )
  .superRefine((v, ctx) => {
    const c = checkRef(v)
    if (!c.ok) ctx.addIssue({ code: 'custom', message: c.error })
  })

// ───────────── hadith / sources ─────────────
export const HadithRefSchema = z.strictObject({
  collection: z.string().trim().min(2).max(80),
  number: z.string().trim().min(1).max(30),
  grading: z.string().trim().min(2).max(120),
  grading_by: z.string().trim().max(120).nullish(),
  note: text(500).nullish(),
}, { error: (iss) => iss.code === 'unrecognized_keys' ? 'Hadith text is not accepted. Provide collection, number and grading only.' : undefined })

export const SourceSchema = z.object({
  slug: SlugSchema,
  book: z.string().trim().min(2).max(200),
  author: z.string().trim().min(2).max(200),
  edition: z.string().trim().max(200).nullish(),
})

export const CitationSchema = z.object({
  event_slug: SlugSchema,
  source_slug: SlugSchema,
  volume: z.string().trim().max(30).nullish(),
  page: z.string().trim().min(1, 'page is required: cite book, volume/page').max(30),
  note: z.string().trim().max(500).nullish(),
})

// ───────────── places / routes ─────────────
export const PlaceTypeSchema = z.enum(PLACE_TYPES, { error: () => `type must be one of: ${PLACE_TYPES.join(', ')} (region ≈ zoom 6, city ≈ zoom 12, site ≈ zoom 17; a site such as the Kaaba or Zamzam belongs to a city).` })
export const PlaceRoleSchema = z.enum(EVENT_PLACE_ROLES)
export const ZoomSchema = z.number().int().min(MIN_ZOOM_OVERRIDE).max(MAX_ZOOM_OVERRIDE)
const lat = z.number().min(-90).max(90)
const lng = z.number().min(-180).max(180)

export const CreatePlaceSchema = z.object({
  slug: SlugSchema,
  type: PlaceTypeSchema,
  lat,
  lng,
  names: z.partialRecord(LangSchema, z.string().trim().min(1).max(120)).refine((n) => Object.keys(n).length > 0, 'provide at least one name'),
  parent_place_slug: SlugSchema.optional().describe('Slug of the containing place: a site\'s city, or a city\'s region.'),
  zoom: ZoomSchema.optional().describe('Optional map zoom for this place; defaults by type (region 6, city 12, site 17).'),
  allow_outside_arabia: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (!v.allow_outside_arabia && !inArabiaBBox(v.lng, v.lat))
    ctx.addIssue({ code: 'custom', path: ['lat'], message: `Coordinates (${v.lat}, ${v.lng}) are outside the Arabian Peninsula bounding box [${ARABIA_BBOX.join(', ')}] (lng/lat). Check the order (lat first, lng second) or set allow_outside_arabia: true.` })
})

export const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([lng, lat])).min(2, 'a route needs at least 2 points').max(2000),
})

export const CreateRouteSchema = z.object({
  slug: SlugSchema,
  names: z.partialRecord(LangSchema, z.string().trim().min(1).max(120)).refine((n) => Object.keys(n).length > 0, 'provide at least one name'),
  geojson: LineStringSchema,
  allow_outside_arabia: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.allow_outside_arabia) return
  v.geojson.coordinates.forEach(([x, y], i) => {
    if (!inArabiaBBox(x, y))
      ctx.addIssue({ code: 'custom', path: ['geojson', 'coordinates', i], message: `Point ${i} [${x}, ${y}] is outside the Arabian Peninsula bounding box [${ARABIA_BBOX.join(', ')}]. GeoJSON order is [lng, lat]; set allow_outside_arabia: true if intended.` })
  })
})

// ───────────── recall ─────────────
export const RecallItemSchema = z.object({
  question: text(400),
  answer: text(400),
  distractors: z.array(text(400)).min(2, 'provide at least 2 distractors').max(5),
}).superRefine((v, ctx) => {
  const all = [v.answer, ...v.distractors].map((s) => s.trim().toLowerCase())
  if (new Set(all).size !== all.length) ctx.addIssue({ code: 'custom', path: ['distractors'], message: 'answer and distractors must all be different.' })
})

export const RecallQuestionSchema = z.object({
  event_slug: SlugSchema,
  lang: LangSchema,
  question: text(400),
  answer: text(400),
  distractors: z.array(text(400)).min(2, 'provide at least 2 distractors').max(5),
}).superRefine((v, ctx) => {
  const all = [v.answer, ...v.distractors].map((s) => s.trim().toLowerCase())
  if (new Set(all).size !== all.length) ctx.addIssue({ code: 'custom', path: ['distractors'], message: 'answer and distractors must all be different.' })
})

// ───────────── media: no people, ever ─────────────
export const ALLOWED_MEDIA_KINDS = ['map', 'landscape', 'architecture', 'object', 'pattern', 'calligraphy'] as const
export const ALLOWED_MEDIA_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'] as const // SVG rejected: can embed script
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024

export const MediaKindSchema = z.enum(ALLOWED_MEDIA_KINDS, {
  error: () => `kind must be one of: ${ALLOWED_MEDIA_KINDS.join(', ')}. Images depicting people (the Prophet ﷺ, other prophets, companions, family, angels) are never allowed.`,
})

// Where a picture sits inside the event page. Structured only: never put markers inside text fields.
import { MEDIA_PLACEMENTS, placementProblem, type MediaPlacement } from './placement'
export { MEDIA_PLACEMENTS, placementProblem, type MediaPlacement }
export const MediaPlacementSchema = z.enum(MEDIA_PLACEMENTS, { error: () => `placement must be one of: ${MEDIA_PLACEMENTS.join(', ')}.` })

export const PlacementFields = {
  placement: MediaPlacementSchema.default('gallery').describe('hero: under the title; after_summary; in_key_details: after one key detail (needs after_key_detail_index); before_lessons; gallery (default): grid at the end.'),
  after_key_detail_index: z.number().int().min(0).max(14).optional().describe('Only for in_key_details. 0-based: 0 puts the picture after the FIRST key detail, 1 after the second, and so on. It must exist in the default-language key_details.'),
  order: z.number().int().min(0).max(999).optional().describe('Order among pictures with the same placement (lowest first).'),
}

export const UploadMediaSchema = z.object({
  kind: MediaKindSchema,
  mime: z.enum(ALLOWED_MEDIA_MIME),
  alt: z.partialRecord(LangSchema, z.string().trim().min(3).max(300)).refine((a) => Object.keys(a).length > 0, 'alt text is required in at least one language'),
  caption: z.partialRecord(LangSchema, z.string().trim().min(1).max(300)).optional().describe('Optional caption shown under the picture, per language.'),
  credit: z.string().trim().min(1).max(200).optional().describe('Optional credit / licence line, e.g. "Photo: … (CC BY-SA 4.0)".'),
  ...PlacementFields,
  contains_people_confirmation: z.literal(false, { error: 'contains_people_confirmation must be false: images with any people, faces or figures are rejected.' }),
  base64: z.string().min(1),
}).superRefine((v, ctx) => {
  const pp = placementProblem(v)
  if (pp) ctx.addIssue({ code: 'custom', path: ['placement'], message: pp })
  const approxBytes = Math.floor((v.base64.length * 3) / 4)
  if (approxBytes > MAX_MEDIA_BYTES) ctx.addIssue({ code: 'custom', path: ['base64'], message: `image is ${approxBytes} bytes; the limit is ${MAX_MEDIA_BYTES}.` })
})

// ───────────── tokens ─────────────
export const CreateApiTokenSchema = z.object({
  label: z.string().trim().min(2).max(80),
  role: RoleSchema.default('editor'),
  expires_in_days: z.number().int().min(1).max(365).default(90),
})

// ───────────── publish gate ─────────────
export interface PublishCandidate {
  certainty: 'agreed' | 'disputed' | null
  sourceCount: number
  translations: { lang: string; title?: string | null; summary?: string | null; dispute_note?: string | null }[]
  defaultLang?: string
  /** Places linked to the event with role "primary". Exactly one is required. */
  primaryPlaceCount: number
  /** Number of key_details in the default-language translation, and the event's pictures, to validate placements. */
  keyDetailCount?: number
  media?: { id: string; placement: MediaPlacement; after_key_detail_index?: number | null }[]
}

/** Returns a list of problems that block publishing; empty means publishable. */
export function publishBlockers(c: PublishCandidate): string[] {
  const out: string[] = []
  const lang = c.defaultLang ?? DEFAULT_LANG
  if (c.sourceCount < 1) out.push('At least one source citation (book + volume/page) is required. Use create_source then add_source_citation.')
  if (!c.certainty) out.push('Certainty flag is not set. Use set_certainty (agreed | disputed).')
  const t = c.translations.find((x) => x.lang === lang)
  if (!t || !t.title || !t.summary) out.push(`A "${lang}" translation with title and summary is required before publishing.`)
  if (c.certainty === 'disputed' && !c.translations.some((x) => x.dispute_note)) out.push('Certainty is "disputed" but no dispute_note explains the positions.')
  if (c.primaryPlaceCount === 0) out.push('No primary place. Use set_primary_place (or add_event_place with role "primary").')
  else if (c.primaryPlaceCount > 1) out.push(`${c.primaryPlaceCount} primary places; exactly one is allowed. Use set_primary_place to choose.`)
  for (const m of c.media ?? []) {
    const pp = placementProblem(m, c.keyDetailCount ?? 0)
    if (pp) out.push(`Picture ${m.id}: ${pp} Fix it with set_media_placement.`)
  }
  return out
}

// ───────────── patch-style translation update (no defaults, so omitted fields stay untouched) ─────────────
export const UpdateEventTranslationSchema = z.object({
  lang: LangSchema,
  title: text(160).optional(),
  summary: text(1200).optional(),
  key_details: textList(15, 400).optional(),
  lessons: textList(10, 600).optional(),
  dispute_note: text(1500).nullable().optional(),
  my_reflection: text(3000).nullable().optional(),
})

export const MAX_SLUG = 80
