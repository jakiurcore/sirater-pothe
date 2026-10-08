import { z } from 'zod'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/server'
import { schema as s } from '@seerah/db'
import {
  ARABIC_DATASET, CitationSchema, HadithRefSchema, LangSchema, RecallItemSchema, SlugSchema, SourceSchema, DEFAULT_LANG,
  checkRef, formatRef, getAyat, getTranslationMeta, availableTranslationLangs,
} from '@seerah/content'
import { assertCanEdit, defineTool, type ToolCtx } from './kit'
import { eventBySlug, sourceBySlug, touch, withRevision } from '../data'
import { ToolError, uuid } from '../util'

const noQuranText = (iss: { code: string }) =>
  iss.code === 'unrecognized_keys'
    ? "Qur'an text is never accepted from the client. Send only event_slug, surah, ayah (and optional ayahTo, lang); the server fills the Arabic and translation from verified datasets."
    : undefined

const AttachAyahInput = z.strictObject({
  event_slug: SlugSchema,
  surah: z.number().int().describe('1-114'),
  ayah: z.number().int().describe('first ayah'),
  ayahTo: z.number().int().optional().describe('last ayah of a range in the same surah (max 20 ayat)'),
  lang: LangSchema.default('bn').describe('Language of the translation to fetch (bundled: ' + availableTranslationLangs().join(', ') + ').'),
}, { error: noQuranText })

const DetachAyahInput = z.strictObject({
  event_slug: SlugSchema, surah: z.number().int(), ayah: z.number().int(), ayahTo: z.number().int().optional(),
}, { error: noQuranText })

export function registerContentTools(server: McpServer, ctx: ToolCtx) {
  const { db, actor } = ctx

  defineTool(server, ctx, 'attach_ayah', {
    title: 'Attach ayah (reference only)',
    description: "Attach Qur'an ayat to an event BY REFERENCE. The server validates surah:ayah against the 114-surah table and fills in the Arabic (Tanzil Uthmani) and translation itself. Returns the fetched text: SHOW IT TO THE OWNER and ask them to confirm it fits the event before continuing; use detach_ayah if not. Never send Arabic text yourself.",
    access: 'write',
    input: AttachAyahInput,
  }, async (a) => {
    const c = checkRef({ surah: a.surah, ayah: a.ayah, ayahTo: a.ayahTo })
    if (!c.ok) throw new ToolError(c.error)
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
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
        ...fresh.map((t, i) => db.insert(s.eventAyat).values({ eventId: ev.id, ayahId: `${t.surah}:${t.ayah}`, orderIndex: have.size + i })),
        touch(db, ev.id),
      ],
    })
    return {
      ok: true, event: a.event_slug, ref: formatRef(c.ref), revision_id: revisionId,
      already_attached: texts.length - fresh.length || undefined,
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
      build: () => [db.delete(s.eventAyat).where(and(eq(s.eventAyat.eventId, ev.id), inArray(s.eventAyat.ayahId, ids))), touch(db, ev.id)],
    })
    return { ok: true, detached: linked.map((l) => l.id), revision_id: revisionId }
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
    title: 'Create source', description: 'Register a book (title, author, edition) that can then be cited with add_source_citation.', access: 'write', input: SourceSchema,
  }, async (a) => {
    if (await db.query.sources.findFirst({ where: eq(s.sources.slug, a.slug) })) throw new ToolError(`Source "${a.slug}" already exists; cite it with add_source_citation.`)
    const id = uuid()
    const { revisionId } = await withRevision(db, actor, {
      entity: 'source', entityId: id, action: 'create',
      build: () => [db.insert(s.sources).values({ id, slug: a.slug, book: a.book, author: a.author, edition: a.edition ?? null })],
    })
    return { ok: true, slug: a.slug, revision_id: revisionId }
  })

  defineTool(server, ctx, 'add_source_citation', {
    title: 'Add source citation', description: 'Cite a registered source for an event with volume and page (required). At least one citation is required to publish.', access: 'write', input: CitationSchema,
  }, async (a) => {
    const ev = await eventBySlug(db, a.event_slug)
    assertCanEdit(ctx, ev.status)
    const src = await sourceBySlug(db, a.source_slug)
    const dup = await db.query.eventSources.findFirst({ where: and(eq(s.eventSources.eventId, ev.id), eq(s.eventSources.sourceId, src.id), eq(s.eventSources.page, a.page), a.volume ? eq(s.eventSources.volume, a.volume) : sql`${s.eventSources.volume} is null`) })
    if (dup) throw new ToolError('That exact citation (source, volume, page) is already on this event.')
    const id = uuid()
    const { revisionId } = await withRevision(db, actor, {
      entity: 'event', entityId: ev.id, action: 'add_citation',
      build: () => [db.insert(s.eventSources).values({ id, eventId: ev.id, sourceId: src.id, volume: a.volume ?? null, page: a.page, note: a.note ?? null }), touch(db, ev.id)],
    })
    return { ok: true, citation_id: id, event: a.event_slug, source: a.source_slug, revision_id: revisionId }
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
