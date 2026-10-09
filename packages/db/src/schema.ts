import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const id = () => text('id').primaryKey()
const createdAt = () => text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
const updatedAt = () => text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)

// ───────── eras ─────────
export const eras = sqliteTable('eras', {
  id: id(),
  slug: text('slug').notNull().unique(),
  orderIndex: integer('order_index').notNull(),
  startHijri: integer('start_hijri'),
  endHijri: integer('end_hijri'),
})
export const eraTranslations = sqliteTable('era_translations', {
  eraId: text('era_id').notNull().references(() => eras.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
}, (t) => [primaryKey({ columns: [t.eraId, t.lang] })])

// ───────── places / routes ─────────
export const places = sqliteTable('places', {
  id: id(),
  slug: text('slug').notNull().unique(),
  /** region ≈ zoom 6, city ≈ 12, site ≈ 17 (see @seerah/content geo). */
  type: text('type', { enum: ['region', 'city', 'site'] }).notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  /** The containing place: a site's city, a city's region. */
  parentPlaceId: text('parent_place_id').references((): AnySQLiteColumn => places.id, { onDelete: 'set null' }),
  /** Optional camera zoom for this place; otherwise the type's default. */
  zoomOverride: integer('zoom_override'),
})
export const placeTranslations = sqliteTable('place_translations', {
  placeId: text('place_id').notNull().references(() => places.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull(),
  name: text('name').notNull(),
}, (t) => [primaryKey({ columns: [t.placeId, t.lang] })])

export const routes = sqliteTable('routes', {
  id: id(),
  slug: text('slug').notNull().unique(),
  /** GeoJSON LineString, [lng, lat] order. */
  geojson: text('geojson', { mode: 'json' }).$type<{ type: 'LineString'; coordinates: [number, number][] }>().notNull(),
})
export const routeTranslations = sqliteTable('route_translations', {
  routeId: text('route_id').notNull().references(() => routes.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull(),
  name: text('name').notNull(),
}, (t) => [primaryKey({ columns: [t.routeId, t.lang] })])

// ───────── events ─────────
export const events = sqliteTable('events', {
  id: id(),
  slug: text('slug').notNull().unique(),
  eraId: text('era_id').notNull().references(() => eras.id),
  orderIndex: integer('order_index').notNull(),
  /** Negative = before the Hijrah. There is no year 0. */
  hijriYear: integer('hijri_year'),
  gregorianApprox: integer('gregorian_approx'),
  prophetAge: integer('prophet_age'),
  /** DEPRECATED: mirror of the primary row in event_places, kept in sync for readers that predate the join table. Read event_places. */
  placeId: text('place_id').references(() => places.id, { onDelete: 'set null' }),
  routeId: text('route_id').references(() => routes.id, { onDelete: 'set null' }),
  certainty: text('certainty', { enum: ['agreed', 'disputed'] }).notNull().default('agreed'),
  status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
  /** Seed/sample content flagged until the owner has checked it. */
  needsVerification: integer('needs_verification', { mode: 'boolean' }).notNull().default(false),
  publishedAt: text('published_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('events_status_order').on(t.status, t.orderIndex), index('events_era').on(t.eraId)])

/** Places of an event: one `primary` (the map flies to it) plus related / route_start / route_end. */
export const eventPlaces = sqliteTable('event_places', {
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  placeId: text('place_id').notNull().references(() => places.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['primary', 'related', 'route_start', 'route_end'] }).notNull().default('related'),
  orderIndex: integer('order_index').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.eventId, t.placeId] }),
  // The database itself refuses a second primary place for the same event.
  uniqueIndex('event_places_one_primary').on(t.eventId).where(sql`${t.role} = 'primary'`),
  index('event_places_place').on(t.placeId),
])

export const eventTranslations = sqliteTable('event_translations', {
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  keyDetails: text('key_details', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  lessons: text('lessons', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  disputeNote: text('dispute_note'),
  myReflection: text('my_reflection'),
  /** Non-default-language translations are saved as drafts until reviewed. */
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.eventId, t.lang] })])

// ───────── people (names only — never imagery) ─────────
export const people = sqliteTable('people', {
  id: id(),
  slug: text('slug').notNull().unique(),
})
export const personTranslations = sqliteTable('person_translations', {
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull(),
  name: text('name').notNull(),
}, (t) => [primaryKey({ columns: [t.personId, t.lang] })])
export const eventPeople = sqliteTable('event_people', {
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.eventId, t.personId] })])

// ───────── sources ─────────
export const sources = sqliteTable('sources', {
  id: id(),
  slug: text('slug').notNull().unique(),
  book: text('book').notNull(),
  author: text('author').notNull(),
  edition: text('edition'),
})
export const eventSources = sqliteTable('event_sources', {
  id: id(),
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull().references(() => sources.id),
  volume: text('volume'),
  /** Page number or range; null when the citation is by chapter/section title. */
  page: text('page'),
  /** Chapter / section / bab title (alternative locator). */
  section: text('section'),
  note: text('note'),
}, (t) => [index('event_sources_event').on(t.eventId)])

// ───────── ayat (text filled by server from bundled datasets) ─────────
export const ayat = sqliteTable('ayat', {
  id: id(),
  surah: integer('surah').notNull(),
  ayah: integer('ayah').notNull(),
  arabicText: text('arabic_text').notNull(),
  arabicSource: text('arabic_source').notNull(),
}, (t) => [uniqueIndex('ayat_ref').on(t.surah, t.ayah)])
export const ayahTranslations = sqliteTable('ayah_translations', {
  ayahId: text('ayah_id').notNull().references(() => ayat.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull(),
  text: text('text').notNull(),
  /** Dataset id, e.g. "tanzil-bn.bengali" */
  translationSource: text('translation_source').notNull(),
  translationLicense: text('translation_license').notNull(),
}, (t) => [primaryKey({ columns: [t.ayahId, t.lang] })])
export const eventAyat = sqliteTable('event_ayat', {
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  ayahId: text('ayah_id').notNull().references(() => ayat.id),
  /** Order inside its slot (ayat and pictures share slots; lowest first). */
  orderIndex: integer('order_index').notNull().default(0),
  /** Same placement model as media (see @seerah/content placement). `hero` + a high order = where ayat rendered before placement existed. */
  placement: text('placement', { enum: ['hero', 'in_summary', 'after_summary', 'in_key_details', 'in_lessons', 'before_lessons', 'end'] }).notNull().default('hero'),
  /** 0-based paragraph / key detail / lesson it follows (in_summary / in_key_details / in_lessons only). */
  afterIndex: integer('after_index'),
}, (t) => [primaryKey({ columns: [t.eventId, t.ayahId] })])

/** A short sentence per language, shown small above the ayah card, saying why the ayah is in this spot. */
export const eventAyatNotes = sqliteTable('event_ayat_notes', {
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  ayahId: text('ayah_id').notNull().references(() => ayat.id),
  lang: text('lang').notNull(),
  note: text('note').notNull(),
}, (t) => [primaryKey({ columns: [t.eventId, t.ayahId, t.lang] })])

// ───────── hadith (references only) ─────────
export const hadithRefs = sqliteTable('hadith_refs', {
  id: id(),
  collection: text('collection').notNull(),
  number: text('number').notNull(),
  grading: text('grading').notNull(),
  gradingBy: text('grading_by'),
  note: text('note'),
}, (t) => [uniqueIndex('hadith_ref').on(t.collection, t.number)])
export const eventHadith = sqliteTable('event_hadith', {
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  hadithId: text('hadith_id').notNull().references(() => hadithRefs.id),
}, (t) => [primaryKey({ columns: [t.eventId, t.hadithId] })])

// ───────── recall ─────────
export const recallQuestions = sqliteTable('recall_questions', {
  id: id(),
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull().default(0),
}, (t) => [index('recall_event').on(t.eventId)])
export const recallQuestionTranslations = sqliteTable('recall_question_translations', {
  questionId: text('question_id').notNull().references(() => recallQuestions.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  distractors: text('distractors', { mode: 'json' }).$type<string[]>().notNull(),
}, (t) => [primaryKey({ columns: [t.questionId, t.lang] })])

// ───────── media (no people) ─────────
export const media = sqliteTable('media', {
  id: id(),
  r2Key: text('r2_key').notNull().unique(),
  kind: text('kind', { enum: ['map', 'landscape', 'architecture', 'object', 'pattern', 'calligraphy'] }).notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  eventId: text('event_id').references(() => events.id, { onDelete: 'set null' }),
  /** Where it sits in the event page. Structured only: never markers inside text. */
  placement: text('placement', { enum: ['hero', 'in_summary', 'after_summary', 'in_key_details', 'in_lessons', 'before_lessons', 'end', 'gallery'] }).notNull().default('gallery'),
  /** 0-based paragraph / key detail / lesson the picture follows (in_summary / in_key_details / in_lessons only). */
  afterIndex: integer('after_index'),
  orderIndex: integer('order_index').notNull().default(0),
  credit: text('credit'),
  width: integer('width'),
  height: integer('height'),
  /** Where the picture came from and under which licence (filled automatically for Wikimedia Commons). */
  license: text('license'),
  author: text('author'),
  sourceUrl: text('source_url'),
  /** Responsive copies: { "480": "media/<id>-480.webp", ... }. Empty/null: only the original exists. */
  variants: text('variants', { mode: 'json' }).$type<Record<string, string>>(),
  /** SHA-256 of the stored original (after metadata stripping). */
  sha256: text('sha256'),
  createdAt: createdAt(),
}, (t) => [index('media_event').on(t.eventId)])
export const mediaAlt = sqliteTable('media_alt', {
  mediaId: text('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull(),
  alt: text('alt').notNull(),
  caption: text('caption'),
}, (t) => [primaryKey({ columns: [t.mediaId, t.lang] })])

// ───────── history, audit, access ─────────
export const revisions = sqliteTable('revisions', {
  id: id(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  beforeJson: text('before_json', { mode: 'json' }),
  afterJson: text('after_json', { mode: 'json' }),
  actor: text('actor').notNull(),
  revertedBy: text('reverted_by'),
  createdAt: createdAt(),
}, (t) => [index('revisions_entity').on(t.entity, t.entityId, t.createdAt)])

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actor: text('actor').notNull(),
  role: text('role'),
  tool: text('tool').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  detail: text('detail'),
  createdAt: createdAt(),
})

export const previewTokens = sqliteTable('preview_tokens', {
  /** SHA-256 of the token; the token itself is only in the URL. */
  tokenHash: text('token_hash').primaryKey(),
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
})

export const apiTokens = sqliteTable('api_tokens', {
  id: id(),
  /** SHA-256 of the token; the token is shown once at creation. */
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(),
  role: text('role', { enum: ['owner', 'editor'] }).notNull(),
  owner: text('owner').notNull(),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
  lastUsedAt: text('last_used_at'),
  createdAt: createdAt(),
})

/** Records dataset provenance (Tanzil text, translations) used to fill ayat. */
export const contentDatasets = sqliteTable('content_datasets', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['arabic', 'translation'] }).notNull(),
  lang: text('lang').notNull(),
  name: text('name').notNull(),
  license: text('license').notNull(),
  url: text('url'),
  sha256: text('sha256'),
})

// ───────── users (our own login; no signup, rows are created by the CLI scripts only) ─────────
export const users = sqliteTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  /** pbkdf2-sha256$iterations$salt$hash, see @seerah/auth/password. */
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['owner', 'editor'] }).notNull(),
  /** Base32 TOTP seed when 2FA is enabled. */
  totpSecret: text('totp_secret'),
  /** Last accepted TOTP time step (replay protection). */
  totpLastStep: integer('totp_last_step'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: text('locked_until'),
  createdAt: createdAt(),
  lastLoginAt: text('last_login_at'),
  /** Set by `pnpm user:disable`: the account can no longer sign in and existing sessions/tokens stop working. */
  disabledAt: text('disabled_at'),
})

/** Fixed-window counters (per hashed IP) for rate limiting /authorize. */
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull(),
})

// ───────── picture uploads that do not go through a tool call ─────────
/** One-time upload credentials: a signed PUT URL (mode "put") or a link to the site's upload page (mode "link"). Only a hash is stored. */
export const uploadTokens = sqliteTable('upload_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  mode: text('mode', { enum: ['put', 'link'] }).notNull(),
  createdBy: text('created_by').notNull(),
  eventId: text('event_id').references(() => events.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  placement: text('placement').notNull(),
  afterIndex: integer('after_index'),
  orderIndex: integer('order_index'),
  alt: text('alt', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  caption: text('caption', { mode: 'json' }).$type<Record<string, string>>(),
  credit: text('credit'),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  attempts: integer('attempts').notNull().default(0),
  mediaId: text('media_id'),
  createdAt: createdAt(),
})

/** Chunked uploads (the fallback for clients that can only send small JSON messages). Chunks themselves wait in R2 under tmp/<id>/. */
export const uploadSessions = sqliteTable('upload_sessions', {
  id: id(),
  createdBy: text('created_by').notNull(),
  totalSize: integer('total_size').notNull(),
  sha256: text('sha256').notNull(),
  chunkSize: integer('chunk_size').notNull(),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: createdAt(),
})
