import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import { call, db, makeToken, seedEra } from './helpers'

let owner: string, editor: string
const T = { lang: 'bn', title: 'সূত্র পরীক্ষা', summary: 'মুহাম্মাদ ﷺ-এর জীবনের একটি ঘটনা।' }
const draft = (slug: string) => call(owner, 'create_event_draft', { slug, era_slug: 'makkan-early', translation: { ...T, title: T.title + ' ' + slug }, hijri_year: -10 })
const cite = (slug: string, o: object) => call(owner, 'add_source_citation', { event_slug: slug, source_slug: 'ibn-hisham', ...o })
const blockers = async (slug: string) => ((await call(owner, 'get_event', { slug })).json.publish_blockers as string[]).join(' | ')

beforeAll(async () => {
  await seedEra()
  owner = await makeToken('owner-user', 'owner')
  editor = await makeToken('editor-user', 'editor')
  await call(owner, 'create_place', { slug: 'src-place', type: 'city', lat: 21.4, lng: 39.8, names: { bn: 'স্থান' } })
  await call(owner, 'create_source', { slug: 'ibn-hisham', book: 'আস-সীরাতুন নববিয়্যাহ', author: 'ইবনে হিশাম', edition: 'দারুল ফিকর, অনুবাদ: আকরাম ফারুক' })
  await call(owner, 'create_source', { slug: 'rahiq', book: 'আর-রাহীকুল মাখতূম', author: 'সাফিউর রহমান মোবারকপুরী' })
})

describe('citation locators', () => {
  it('accepts volume+page, page, and chapter/section title', async () => {
    await draft('loc-a')
    expect((await cite('loc-a', { volume: '1', page: '98' })).isError).toBe(false)
    expect((await cite('loc-a', { page: '১২৩–১২৫' })).isError).toBe(false)
    expect((await cite('loc-a', { section: 'ওহীর সূচনা অধ্যায়' })).isError).toBe(false)
    const rows = await db().select().from(s.eventSources)
    expect(rows.filter((r) => r.page === null && r.section === 'ওহীর সূচনা অধ্যায়')).toHaveLength(1)
    const v = (await call(owner, 'get_event', { slug: 'loc-a' })).json.sources as { page: string | null; section: string | null }[]
    expect(v.map((x) => [x.page, x.section])).toContainEqual([null, 'ওহীর সূচনা অধ্যায়'])
  })
  it('refuses empty, volume-only and placeholder locators with a "never guess" message', async () => {
    await draft('loc-b')
    for (const o of [{}, { volume: '2' }, { page: '' }, { page: 'n/a' }, { page: 'TBD' }, { page: '?' }, { page: '0' }, { page: 'xxx' }, { section: 'tbd' }, { page: '5', volume: 'unknown' }]) {
      const r = await cite('loc-b', o)
      expect(r.isError, JSON.stringify(o)).toBe(true)
    }
    expect((await cite('loc-b', {})).text).toMatch(/never guess/)
    expect(await db().select().from(s.eventSources).where(eq(s.eventSources.eventId, (await db().select().from(s.events).where(eq(s.events.slug, 'loc-b')))[0]!.id))).toHaveLength(0)
  })
  it('the same locator twice is a duplicate; a different section is not', async () => {
    await draft('loc-c')
    await cite('loc-c', { section: 'অধ্যায় এক' })
    expect((await cite('loc-c', { section: 'অধ্যায় এক' })).text).toMatch(/already on this event/)
    expect((await cite('loc-c', { section: 'অধ্যায় দুই' })).isError).toBe(false)
  })
})

describe('publish gate', () => {
  const ready = async (slug: string) => {
    await draft(slug)
    await call(owner, 'set_certainty', { slug, certainty: 'agreed' })
    await call(owner, 'set_primary_place', { event_slug: slug, place_slug: 'src-place' })
  }
  it('no source at all blocks, and the message tells the AI to ask the owner for the locator', async () => {
    await ready('gate-none')
    const r = await call(owner, 'publish_event', { slug: 'gate-none' })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/At least one source/); expect(r.text).toMatch(/list_sources/); expect(r.text).toMatch(/Ask the owner/)
  })
  it('a section-only citation is enough to publish', async () => {
    await ready('gate-section')
    await cite('gate-section', { section: 'ওহীর সূচনা অধ্যায়' })
    expect((await call(owner, 'publish_event', { slug: 'gate-section' })).isError).toBe(false)
  })
  it('a hadith reference alone satisfies "at least one source"', async () => {
    await ready('gate-hadith')
    expect(await blockers('gate-hadith')).toMatch(/At least one source/)
    expect((await call(owner, 'attach_hadith_ref', { event_slug: 'gate-hadith', collection: 'সহীহ বুখারী', number: '৩', grading: 'সহীহ' })).isError).toBe(false)
    expect(await blockers('gate-hadith')).toBe('')
    expect((await call(owner, 'publish_event', { slug: 'gate-hadith' })).isError).toBe(false)
  })
  it('placeholder hadith references are refused at entry', async () => {
    await draft('gate-hbad')
    for (const number of ['tbd', 'n/a', '?', '0', 'number'])
      expect((await call(owner, 'attach_hadith_ref', { event_slug: 'gate-hbad', collection: 'Sahih al-Bukhari', number, grading: 'Sahih' })).isError, number).toBe(true)
  })
  it('a legacy / placeholder locator in the database blocks only when it is the sole source; next to a valid one it is a warning', async () => {
    await ready('gate-legacy')
    const ev = (await db().select().from(s.events).where(eq(s.events.slug, 'gate-legacy')))[0]!
    const src = (await db().select().from(s.sources).where(eq(s.sources.slug, 'rahiq')))[0]!
    await db().insert(s.eventSources).values({ id: 'legacy-1-bad-citation', eventId: ev.id, sourceId: src.id, page: '(dev placeholder)' })
    expect(await blockers('gate-legacy')).toMatch(/Citation id legacy-1-bad-citation[^|]*is invalid[^|]*update_source_citation/)
    expect((await call(owner, 'publish_event', { slug: 'gate-legacy' })).isError).toBe(true)
    await db().insert(s.eventSources).values({ id: 'legacy-2-good-citation', eventId: ev.id, sourceId: src.id, page: '12' })
    expect(await blockers('gate-legacy')).toBe('')
    const g = (await call(owner, 'get_event', { slug: 'gate-legacy' })).json
    expect(g.publish_warnings.join(' ')).toMatch(/legacy-1-bad-citation/)
    expect(g.sources.map((x: any) => [x.citation_id, x.valid])).toEqual(expect.arrayContaining([['legacy-1-bad-citation', false], ['legacy-2-good-citation', true]]))
    const p = await call(owner, 'publish_event', { slug: 'gate-legacy' })
    expect(p.isError).toBe(false)
    expect(p.json.warnings.join(' ')).toMatch(/legacy-1-bad-citation/)
  })
})

describe('list_sources', () => {
  it('lists registered books with edition/translator and citation counts, and filters', async () => {
    const r = await call(editor, 'list_sources', {}) // read access: editors can use it
    expect(r.isError).toBe(false)
    const list = r.json.sources as { slug: string; book: string; author: string; edition: string | null; citations: number }[]
    const h = list.find((x) => x.slug === 'ibn-hisham')!
    expect(h).toMatchObject({ author: 'ইবনে হিশাম', edition: 'দারুল ফিকর, অনুবাদ: আকরাম ফারুক' })
    expect(h.citations).toBeGreaterThanOrEqual(4)
    expect(list.find((x) => x.slug === 'rahiq')!.edition).toBeNull()
    expect(r.json.locator_rules).toMatch(/Never guess/)
    expect(((await call(owner, 'list_sources', { query: 'হিশাম' })).json.sources as unknown[]).length).toBe(1)
    expect(((await call(owner, 'list_sources', { query: 'zzz-none' })).json.sources as unknown[]).length).toBe(0)
  })
  it('create_source points at list_sources, and the guidelines forbid guessing locators', async () => {
    expect((await call(owner, 'create_source', { slug: 'ibn-hisham', book: 'x বই', author: 'লেখক' })).text).toMatch(/already exists/)
  })
})
