import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
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
  type: text('type', { enum: ['city', 'mountain', 'cave', 'valley', 'plain', 'battlefield', 'region', 'site'] }).notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
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
  page: text('page').notNull(),
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
  orderIndex: integer('order_index').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.eventId, t.ayahId] })])

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
  createdAt: createdAt(),
})
export const mediaAlt = sqliteTable('media_alt', {
  mediaId: text('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull(),
  alt: text('alt').notNull(),
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
