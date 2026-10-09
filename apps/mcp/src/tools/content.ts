import { z } from 'zod'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/server'
import { schema as s } from '@seerah/db'
import {
  ARABIC_DATASET, AyahPlacementFields, addHonorific, CitationSchema, HadithRefSchema, LangSchema, locatorProblem, RecallItemSchema, SlugSchema, SourceSchema, DEFAULT_LANG,
  checkRef, formatRef, getAyat, getTranslationMeta, availableTranslationLangs,
} from '@seerah/content'
import { assertCanEdit, defineTool, type ToolCtx } from './kit'
import { eventBySlug, sourceBySlug, touch, withRevision, loadEventAggregate } from '../data'
import { assertSlot, nextSlotOrder } from '../media/ingest'
import { ToolError, uuid } from '../util'

const noQuranText = (iss: { code: string }) =>
  iss.code === 'unrecognized_keys'
    ? "Qur'an text is never accepted from the client. Send only event_slug, surah, ayah (and optional ayahTo, lang); the server fills the Arabic and translation from verified datasets."
    : undefined

/** One short sentence per language, shown small above the ayah card (why it is here). Never Qur'an text. */
const NoteSchema = z.partialRecord(LangSchema, z.string().trim().min(3).max(200)).describe('Optional: ONE short sentence per language, in correct standard form of that language, saying why this ayah is in this spot (e.g. "এই আয়াতে ইবরাহিম (আ.)-এর দোয়ার উল্লেখ আছে"). For a range it is shown above the first ayah. Never write Qur\'an text here.')
const noteRows = (eventId: string, ayahId: string, note: Record<string, string | undefined> | undefined) =>
  Object.entries(note ?? {}).filter(([, t]) => !!t).map(([lang, t]) => ({ eventId, ayahId, lang, note: addHonorific(t!) }))

const AttachAyahInput = z.strictObject({
  event_slug: SlugSchema,
  surah: z.number().int().describe('1-114'),
  ayah: z.number().int().describe('first ayah'),
  ayahTo: z.number().int().optional().describe('last ayah of a range in the same surah (max 20 ayat)'),
  lang: LangSchema.default('bn').describe('Language of the translation to fetch (bundled: ' + availableTranslationLangs().join(', ') + ').'),
  ...AyahPlacementFields,
  placement_note: NoteSchema.optional(),
}, { error: noQuranText })

const INDEXED = ['in_summary', 'in_key_details', 'in_lessons']

const DetachAyahInput = z.strictObject({
  event_slug: SlugSchema, surah: z.number().int(), ayah: z.number().int(), ayahTo: z.number().int().optional(),
}, { error: noQuranText })

export function registerContentTools(server: McpServer, ctx: ToolCtx) {
  const { db, actor } = ctx

  defineTool(server, ctx, 'attach_ayah', {
    title: 'Attach ayah (reference only)',
    description: "Attach Qur'an ayat to an event BY REFERENCE, at a placement in the page (default after_summary). BEFORE choosing the placement call get_event_layout and pick the paragraph, key detail or lesson the ayah directly supports; explain the choice to the owner. Placements: hero | in_summary (after summary paragraph N) | after_summary | in_key_details (after key detail N) | in_lessons (after lesson N) | before_lessons | end; after_index is 0-based and must exist. The server validates surah:ayah against the 114-surah table and fills in the Arabic (Tanzil Uthmani) and translation itself. Returns the fetched text: SHOW IT TO THE OWNER and ask them to confirm it fits the event before continuing; use detach_ayah if not. Never send Arabic text yourself.",
    access: 'write',
    input: AttachAyahInput,
  }, async (a) => {
    const c = checkRef({ surah: a.surah, ayah: a.ayah, ayahTo: a.ayahTo })
    if (!c.ok) throw new ToolError(c.error)
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const agg = (await loadEventAggregate(db, ev.id))!
    assertSlot(agg, 'ayah', { placement: a.placement, after_index: a.after_index })
    const texts = getAyat(c.ref, a.lang)
    const meta = getTranslationMeta(a.lang)
    const existing = await db.select({ ayahId: s.eventAyat.ayahId }).from(s.eventAyat).where(eq(s.eventAyat.eventId, ev.id))
    const have = new Set(existing.map((x) => x.ayahId))
    const fresh = texts.filter((t) => !have.has(`${t.surah}:${t.ayah}`))
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'attach_ayah',
      build: () => [
        db.insert(s.contentDatasets).values({ id: ARABIC_DATASET.id, kind: 'arabic', lang: 'ar', name: ARABIC_DATASET.name, license: ARABIC_DATASET.license }).onConflictDoNothing(),
        ...(meta ? [db.insert(s.contentDatasets).values({ id: meta.id, kind: 'translation', lang: a.lang, name: meta.name, license: meta.license }).onConflictDoNothing()] : []),
        ...texts.flatMap((t) => [
          db.insert(s.ayat).values({ id: `${t.surah}:${t.ayah}`, surah: t.surah, ayah: t.ayah, arabicText: t.arabic, arabicSource: ARABIC_DATASET.id }).onConflictDoNothing(),
          ...(t.translation !== undefined && meta
            ? [db.insert(s.ayahTranslations).values({ ayahId: `${t.surah}:${t.ayah}`, lang: a.lang, text: t.translation, translationSource: meta.id, translationLicense: meta.license })
                .onConflictDoUpdate({ target: [s.ayahTranslations.ayahId, s.ayahTranslations.lang], set: { text: t.translation, translationSource: meta.id, translationLicense: meta.license } })]
            : []),
        ]),
        ...fresh.map((t, i) => db.insert(s.eventAyat).values({
          eventId: ev.id, ayahId: `${t.surah}:${t.ayah}`, placement: a.placement, afterIndex: INDEXED.includes(a.placement) ? a.after_index! : null,
          orderIndex: a.order !== undefined ? a.order + i : nextSlotOrder(agg, a.placement, INDEXED.includes(a.placement) ? a.after_index! : null) + i,
        })),
        ...(fresh.length ? noteRows(ev.id, `${fresh[0]!.surah}:${fresh[0]!.ayah}`, a.placement_note).map((r) => db.insert(s.eventAyatNotes).values(r).onConflictDoUpdate({ target: [s.eventAyatNotes.eventId, s.eventAyatNotes.ayahId, s.eventAyatNotes.lang], set: { note: r.note } })) : []),
        touch(db, ev.id),
      ],
    })
    return {
      ok: true, event: a.event_slug, ref: formatRef(c.ref), revision_id: revisionId,
      already_attached: texts.length - fresh.length ? `${texts.length - fresh.length} already attached (use set_ayah_placement to move them)` : undefined,
      placement: { placement: a.placement, after_index: INDEXED.includes(a.placement) ? a.after_index : null },
      requires_owner_confirmation: true,
      instruction: 'Show this text to the owner and ask them to confirm. If it is the wrong passage, call detach_ayah.',
      ayat: texts.map((t) => ({ ref: `${t.surah}:${t.ayah}`, arabic: t.arabic, translation: t.translation ?? null })),
      translation_source: meta ? { id: meta.id, name: meta.name } : null,
      translation_note: meta ? undefined : `No bundled "${a.lang}" translation; only the Arabic was stored.`,
      license_warning: meta?.license.startsWith('UNVERIFIED') ? 'The Bangla translation licence is unverified (development only). Do not publish publicly until the owner confirms the licence.' : undefined,
    }
  })

  defineTool(server, ctx, 'detach_ayah', {
    title: 'Detach ayah', description: 'Remove ayat (a reference or range) from an event.', access: 'write', input: DetachAyahInput,
  }, async (a) => {
    const c = checkRef({ surah: a.surah, ayah: a.ayah, ayahTo: a.ayahTo })
    if (!c.ok) throw new ToolError(c.error)
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const ids = Array.from({ length: c.ref.ayahTo - c.ref.ayah + 1 }, (_, i) => `${c.ref.surah}:${c.ref.ayah + i}`)
    const linked = await db.select({ id: s.eventAyat.ayahId }).from(s.eventAyat).where(and(eq(s.eventAyat.eventId, ev.id), inArray(s.eventAyat.ayahId, ids)))
    if (!linked.length) throw new ToolError(`${formatRef(c.ref)} is not attached to "${a.event_slug}".`)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'detach_ayah',
      build: () => [db.delete(s.eventAyatNotes).where(and(eq(s.eventAyatNotes.eventId, ev.id), inArray(s.eventAyatNotes.ayahId, ids))), db.delete(s.eventAyat).where(and(eq(s.eventAyat.eventId, ev.id), inArray(s.eventAyat.ayahId, ids))), touch(db, ev.id)],
    })
    return { ok: true, detached: linked.map((l) => l.id), revision_id: revisionId }
  })

  defineTool(server, ctx, 'set_ayah_placement', {
    title: 'Set ayah placement',
    description: "Move ayat that are already attached to an event: ayah_ref is 'surah:ayah' (e.g. '96:1') or a range ('96:1-5'). placement: hero | in_summary | after_summary | in_key_details | in_lessons | before_lessons | end; after_index (0-based, must exist; see get_event_layout) is required for the three in_ placements. order sorts everything that shares the slot (ayat and pictures). placement_note replaces the one-sentence context line shown above the first ayah (pass null to remove it). Qur'an text is never accepted.",
    access: 'write',
    input: z.strictObject({
      event_slug: SlugSchema,
      ayah_ref: z.string().regex(/^\d{1,3}:\d{1,3}(-\d{1,3})?$/, "ayah_ref looks like '96:1' or '96:1-5'"),
      ...AyahPlacementFields, placement: AyahPlacementFields.placement.unwrap(),
      placement_note: NoteSchema.nullable().optional(),
    }, { error: noQuranText }),
  }, async (a) => {
    const m = /^(\d+):(\d+)(?:-(\d+))?$/.exec(a.ayah_ref)!
    const c = checkRef({ surah: +m[1]!, ayah: +m[2]!, ayahTo: m[3] ? +m[3] : undefined })
    if (!c.ok) throw new ToolError(c.error)
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const agg = (await loadEventAggregate(db, ev.id))!
    const ids = Array.from({ length: c.ref.ayahTo - c.ref.ayah + 1 }, (_, i) => `${c.ref.surah}:${c.ref.ayah + i}`)
    const missing = ids.filter((id) => !agg.ayat.some((x) => x.ayahId === id))
    if (missing.length) throw new ToolError(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not attached to "${a.event_slug}". Attach with attach_ayah first (it takes the placement too).`)
    assertSlot(agg, 'ayah', { placement: a.placement, after_index: a.after_index })
    const idx = INDEXED.includes(a.placement) ? a.after_index! : null
    const base = a.order ?? nextSlotOrder(agg, a.placement, idx, undefined)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'set_ayah_placement',
      build: () => [
        ...ids.map((id, i) => db.update(s.eventAyat).set({ placement: a.placement, afterIndex: idx, orderIndex: base + i }).where(and(eq(s.eventAyat.eventId, ev.id), eq(s.eventAyat.ayahId, id)))),
        ...(a.placement_note !== undefined ? [db.delete(s.eventAyatNotes).where(and(eq(s.eventAyatNotes.eventId, ev.id), eq(s.eventAyatNotes.ayahId, ids[0]!)))] : []),
        ...(a.placement_note ? noteRows(ev.id, ids[0]!, a.placement_note).map((r) => db.insert(s.eventAyatNotes).values(r)) : []),
        touch(db, ev.id),
      ],
    })
    return { ok: true, event: a.event_slug, ayat: ids, placement: a.placement, after_index: idx, revision_id: revisionId, live: ev.status === 'published' ? 'WARNING: this event is published, so the change is already live.' : undefined }
  })

  defineTool(server, ctx, 'attach_hadith_ref', {
    title: 'Attach hadith reference',
    description: 'Record a hadith REFERENCE (collection + number + grading, exactly as the owner cites it). Hadith text is not stored; never invent a number or grading: ask the owner.',
    access: 'write',
    input: z.strictObject({ event_slug: SlugSchema, ...HadithRefSchema.shape }, { error: (iss) => iss.code === 'unrecognized_keys' ? 'Hadith text is not accepted. Provide collection, number and grading only.' : undefined }),
  }, async (a) => {
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const collection = a.collection.trim()
    const prev = await db.query.hadithRefs.findFirst({ where: and(eq(s.hadithRefs.collection, collection), eq(s.hadithRefs.number, a.number)) })
    const id = prev?.id ?? uuid()
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'attach_hadith',
      build: () => [
        prev
          ? db.update(s.hadithRefs).set({ grading: a.grading, gradingBy: a.grading_by ?? null, note: a.note ?? null }).where(eq(s.hadithRefs.id, id))
          : db.insert(s.hadithRefs).values({ id, collection, number: a.number, grading: a.grading, gradingBy: a.grading_by ?? null, note: a.note ?? null }),
        db.insert(s.eventHadith).values({ eventId: ev.id, hadithId: id }).onConflictDoNothing(),
        touch(db, ev.id),
      ],
    })
    return { ok: true, event: a.event_slug, hadith: `${collection} ${a.number}`, grading: a.grading, previous_grading: prev && prev.grading !== a.grading ? prev.grading : undefined, revision_id: revisionId }
  })

  defineTool(server, ctx, 'create_source', {
    title: 'Create source', description: 'Register a book (title, author, edition/translator) that can then be cited with add_source_citation. Call list_sources first: never register a book twice.', access: 'write', input: SourceSchema,
  }, async (a) => {
    if (await db.query.sources.findFirst({ where: eq(s.sources.slug, a.slug) })) throw new ToolError(`Source "${a.slug}" already exists; cite it with add_source_citation.`)
    const id = uuid()
    const { revisionId } = await withRevision(db, actor, {
      entity: 'source', entityId: id, action: 'create',
      build: () => [db.insert(s.sources).values({ id, slug: a.slug, book: a.book, author: a.author, edition: a.edition ?? null })],
    })
    return { ok: true, slug: a.slug, revision_id: revisionId }
  })

  defineTool(server, ctx, 'list_sources', {
    title: 'List registered sources',
    description: 'The books the owner has already registered (slug, title, author, edition/translator) with how many events cite each. Use it before create_source or add_source_citation: pick the slug, then ASK THE OWNER ONLY FOR THE LOCATOR (volume+page, page, or chapter/section title). Optional text filter.',
    access: 'read',
    input: z.object({ query: z.string().trim().max(100).optional().describe('Filter on title, author or slug') }),
  }, async (a) => {
    const rows = await db.select().from(s.sources)
    const counts = await db.select({ id: s.eventSources.sourceId, n: sql<number>`count(*)` }).from(s.eventSources).groupBy(s.eventSources.sourceId)
    const q = a.query?.toLowerCase()
    const list = rows
      .filter((r) => !q || [r.slug, r.book, r.author, r.edition ?? ''].some((v) => v.toLowerCase().includes(q)))
      .sort((x, y) => x.book.localeCompare(y.book))
      .map((r) => ({ slug: r.slug, book: r.book, author: r.author, edition: r.edition, citations: counts.find((c) => c.id === r.id)?.n ?? 0 }))
    return {
      sources: list,
      locator_rules: 'add_source_citation needs ONE of: page (optionally with volume), or a chapter/section title. Hadith: attach_hadith_ref (collection + number), which also counts as a source. Never guess a page or hadith number: ask the owner and wait.',
    }
  })

  defineTool(server, ctx, 'add_source_citation', {
    title: 'Add source citation',
    description: 'Cite a registered source (see list_sources) for an event. The locator must come from the owner and be ONE of: volume + page, page, or chapter/section title. Empty or placeholder locators are refused. At least one citation (or a hadith reference) is required to publish.',
    access: 'write', input: CitationSchema,
  }, async (a) => {
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const src = await sourceBySlug(db, a.source_slug)
    const page = a.page?.trim() || null, section = a.section?.trim() || null, volume = a.volume?.trim() || null
    const same = (col: typeof s.eventSources.page | typeof s.eventSources.section | typeof s.eventSources.volume, v: string | null) => (v ? eq(col, v) : sql`${col} is null`)
    const dup = await db.query.eventSources.findFirst({ where: and(eq(s.eventSources.eventId, ev.id), eq(s.eventSources.sourceId, src.id), same(s.eventSources.page, page), same(s.eventSources.section, section), same(s.eventSources.volume, volume)) })
    if (dup) throw new ToolError('That exact citation (source, volume, page / section) is already on this event.')
    const id = uuid()
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'add_citation',
      build: () => [db.insert(s.eventSources).values({ id, eventId: ev.id, sourceId: src.id, volume, page, section, note: a.note ?? null }), touch(db, ev.id)],
    })
    return { ok: true, citation_id: id, event: a.event_slug, source: a.source_slug, revision_id: revisionId }
  })

  const citationOf = async (eventId: string, citationId: string) => {
    const c = await db.query.eventSources.findFirst({ where: and(eq(s.eventSources.id, citationId), eq(s.eventSources.eventId, eventId)) })
    if (!c) throw new ToolError(`No citation "${citationId}" on this event. Use get_event: every citation has a citation_id.`)
    return c
  }

  defineTool(server, ctx, 'remove_source_citation', {
    title: 'Remove source citation',
    description: 'Remove one citation from an event (use the citation_id from get_event). Typical use: an invalid citation that publish_event or get_event reported. Editors: drafts only; on a published event only the owner. Undo with revert_revision.',
    access: 'write', destructive: true,
    input: z.object({ event_slug: SlugSchema, citation_id: z.string().min(8).max(64) }),
  }, async (a) => {
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const c = await citationOf(ev.id, a.citation_id)
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'remove_citation',
      build: () => [db.delete(s.eventSources).where(eq(s.eventSources.id, c.id)), touch(db, ev.id)],
    })
    return { ok: true, event: a.event_slug, removed: { citation_id: c.id, volume: c.volume, page: c.page, section: c.section }, revision_id: revisionId }
  })

  defineTool(server, ctx, 'update_source_citation', {
    title: 'Update source citation',
    description: 'Change the volume / page / section of one citation (citation_id from get_event). Fields you leave out stay; null or "" clears one. The result must still be a valid locator (volume+page, page, or section title; no placeholders): take it from the owner, never guess. Editors: drafts only; on a published event only the owner.',
    access: 'write',
    input: z.object({
      event_slug: SlugSchema, citation_id: z.string().min(8).max(64),
      volume: z.string().trim().max(30).nullish(), page: z.string().trim().max(30).nullish(), section: z.string().trim().max(200).nullish(),
    }),
  }, async (a) => {
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const c = await citationOf(ev.id, a.citation_id)
    const pick = (given: string | null | undefined, old: string | null) => (given === undefined ? old : given?.trim() || null)
    const next = { volume: pick(a.volume, c.volume), page: pick(a.page, c.page), section: pick(a.section, c.section) }
    const problem = locatorProblem(next)
    if (problem) throw new ToolError(`${problem}. Valid locators: volume+page, page, or chapter/section title. Ask the owner; never guess. Nothing was changed.`)
    const dup = (await db.select().from(s.eventSources).where(and(eq(s.eventSources.eventId, ev.id), eq(s.eventSources.sourceId, c.sourceId))))
      .find((x) => x.id !== c.id && (x.volume ?? null) === next.volume && (x.page ?? null) === next.page && (x.section ?? null) === next.section)
    if (dup) throw new ToolError('Another citation of this source on this event already has exactly that locator.')
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'update_citation',
      build: () => [db.update(s.eventSources).set(next).where(eq(s.eventSources.id, c.id)), touch(db, ev.id)],
    })
    return { ok: true, event: a.event_slug, citation_id: c.id, before: { volume: c.volume, page: c.page, section: c.section }, after: next, revision_id: revisionId }
  })

  defineTool(server, ctx, 'detach_hadith_ref', {
    title: 'Detach hadith reference',
    description: 'Remove a hadith reference from an event (hadith_ref_id from get_event). The reference record itself is kept for other events. Editors: drafts only; on a published event only the owner. Undo with revert_revision.',
    access: 'write', destructive: true,
    input: z.object({ event_slug: SlugSchema, hadith_ref_id: z.string().min(8).max(64) }),
  }, async (a) => {
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const link = await db.query.eventHadith.findFirst({ where: and(eq(s.eventHadith.eventId, ev.id), eq(s.eventHadith.hadithId, a.hadith_ref_id)) })
    if (!link) throw new ToolError(`No hadith reference "${a.hadith_ref_id}" on this event. Use get_event: every hadith has a hadith_ref_id.`)
    const ref = await db.query.hadithRefs.findFirst({ where: eq(s.hadithRefs.id, a.hadith_ref_id) })
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'detach_hadith',
      build: () => [db.delete(s.eventHadith).where(and(eq(s.eventHadith.eventId, ev.id), eq(s.eventHadith.hadithId, a.hadith_ref_id))), touch(db, ev.id)],
    })
    return { ok: true, event: a.event_slug, detached: ref ? `${ref.collection} ${ref.number}` : a.hadith_ref_id, revision_id: revisionId }
  })

  defineTool(server, ctx, 'add_recall_questions', {
    title: 'Add recall questions',
    description: 'Add multiple-choice review questions (question, correct answer, 2-5 wrong distractors) for spaced-repetition review. Questions must test facts stated in the event.',
    access: 'write',
    input: z.object({ event_slug: SlugSchema, lang: LangSchema.default(DEFAULT_LANG), questions: z.array(RecallItemSchema).min(1).max(10) }),
  }, async (a) => {
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)` }).from(s.recallQuestions).where(eq(s.recallQuestions.eventId, ev.id))
    const ids = a.questions.map(() => uuid())
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'add_recall',
      build: () => [
        ...a.questions.flatMap((q, i) => [
          db.insert(s.recallQuestions).values({ id: ids[i]!, eventId: ev.id, orderIndex: n + i }),
          db.insert(s.recallQuestionTranslations).values({ questionId: ids[i]!, lang: a.lang, question: q.question, answer: q.answer, distractors: q.distractors }),
        ]),
        touch(db, ev.id),
      ],
    })
    return { ok: true, event: a.event_slug, added: ids, revision_id: revisionId }
  })
}
