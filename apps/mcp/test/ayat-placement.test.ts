import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import { call, db, makeToken, seedEra } from './helpers'
import { nextSlotOrder } from '../src/media/ingest'
import { pngBytes, b64 } from './fixtures'

let owner: string, editor: string
const KD = ['প্রথম বিবরণ', 'দ্বিতীয় বিবরণ', 'তৃতীয় বিবরণ']
const T = { lang: 'bn', title: 'আয়াত স্থান', summary: 'প্রথম অনুচ্ছেদ।\n\nদ্বিতীয় অনুচ্ছেদ।\n\nতৃতীয় অনুচ্ছেদ।', key_details: KD, lessons: ['প্রথম শিক্ষা', 'দ্বিতীয় শিক্ষা'] }
const mk = (slug: string, tr: object = T) => call(owner, 'create_event_draft', { slug, era_slug: 'makkan-early', translation: { ...T, ...tr, title: 'ঘটনা ' + slug } })
const attach = (slug: string, extra: object = {}) => call(owner, 'attach_ayah', { event_slug: slug, surah: 96, ayah: 1, ...extra })
const ayat = async (slug: string) => (await call(owner, 'get_event', { slug })).json.ayat as { ref: string; placement: string; after_index: number | null; order: number; placement_note: Record<string, string>; arabic: string }[]
const layout = async (slug: string, lang?: string) => (await call(owner, 'get_event_layout', { event: slug, ...(lang ? { lang } : {}) })).json

beforeAll(async () => {
  await seedEra()
  owner = await makeToken('owner-user', 'owner')
  editor = await makeToken('editor-user', 'editor')
  await mk('ay-1'); await mk('ay-2'); await mk('ay-3', { summary: 'একটিই অনুচ্ছেদ।', key_details: [], lessons: [] })
})

describe('attach_ayah with a placement', () => {
  it('places an ayah after a key detail and returns the fetched text for the owner to confirm', async () => {
    const r = await attach('ay-1', { placement: 'in_key_details', after_index: 1, placement_note: { bn: 'এই আয়াতে প্রথম ওহীর উল্লেখ আছে।' } })
    expect(r.isError).toBe(false)
    expect(r.json).toMatchObject({ requires_owner_confirmation: true, placement: { placement: 'in_key_details', after_index: 1 } })
    expect(r.json.ayat[0].arabic).toBeTruthy()
    expect(await ayat('ay-1')).toMatchObject([{ ref: '96:1', placement: 'in_key_details', after_index: 1, order: 0, placement_note: { bn: 'এই আয়াতে প্রথম ওহীর উল্লেখ আছে।' } }])
  })
  it('defaults to after_summary and never accepts gallery or Qur\'an text', async () => {
    await attach('ay-2')
    expect((await ayat('ay-2'))[0]).toMatchObject({ placement: 'after_summary', after_index: null })
    expect((await attach('ay-2', { surah: 96, ayah: 2, placement: 'gallery' })).isError).toBe(true)
    expect((await attach('ay-2', { surah: 96, ayah: 2, arabic: 'اقرأ' })).text).toMatch(/never accepted from the client/)
    expect((await attach('ay-2', { surah: 96, ayah: 2, placement_note: { bn: 'আয়াত' }, arabic_text: 'x' })).isError).toBe(true)
  })
  it('validates the index against the text and says what is valid, for each of the three sections', async () => {
    expect((await attach('ay-1', { ayah: 3, placement: 'in_summary', after_index: 3 })).text).toMatch(/summary: the event has 3 summary paragraphs \(valid after_index 0–2\)/)
    expect((await attach('ay-1', { ayah: 3, placement: 'in_key_details', after_index: 3 })).text).toMatch(/key_details: the event has 3 key details \(valid after_index 0–2\)/)
    expect((await attach('ay-1', { ayah: 3, placement: 'in_lessons', after_index: 2 })).text).toMatch(/lessons: the event has 2 lessons \(valid after_index 0–1\)/)
    expect((await attach('ay-1', { ayah: 3, placement: 'in_lessons' })).text).toMatch(/needs after_index/)
    expect((await attach('ay-1', { ayah: 3, placement: 'hero', after_index: 0 })).text).toMatch(/only applies to in_summary/)
    expect((await attach('ay-3', { placement: 'in_lessons', after_index: 0 })).text).toMatch(/no lessons yet/)
    expect((await attach('ay-3', { placement: 'in_key_details', after_index: 0 })).text).toMatch(/no key_details yet/)
    expect((await attach('ay-3', { placement: 'in_summary', after_index: 0 })).isError).toBe(false) // one paragraph is enough
    expect((await attach('ay-1', { ayah: 3, placement: 'in_summary', after_index: 2 })).isError).toBe(false)
    expect((await ayat('ay-1')).find((a) => a.ref === '96:3')).toMatchObject({ placement: 'in_summary', after_index: 2 })
  })
  it('a range keeps its order, and the note goes above the first ayah', async () => {
    await mk('ay-range')
    const r = await call(owner, 'attach_ayah', { event_slug: 'ay-range', surah: 105, ayah: 1, ayahTo: 3, placement: 'in_lessons', after_index: 0, placement_note: { bn: 'সূরা ফীলের শুরু।' } })
    expect(r.isError).toBe(false)
    const a = await ayat('ay-range')
    expect(a.map((x) => [x.ref, x.order])).toEqual([['105:1', 0], ['105:2', 1], ['105:3', 2]])
    expect(a.map((x) => Object.keys(x.placement_note).length)).toEqual([1, 0, 0])
  })
  it('the honorific is added to placement notes; an editor can place on drafts but not move ayat on a published event', async () => {
    await mk('ay-hon')
    await attach('ay-hon', { placement_note: { bn: 'এখানে মুহাম্মাদ এর কথা আছে।' } })
    expect((await ayat('ay-hon'))[0]!.placement_note.bn).toContain('মুহাম্মাদ ﷺ')
    expect((await call(editor, 'attach_ayah', { event_slug: 'ay-hon', surah: 96, ayah: 2, placement: 'end' })).isError).toBe(false)
  })
})

describe('set_ayah_placement', () => {
  it('moves one ayah or a range; validates; requires the ayah to be attached; updates or clears the note', async () => {
    await mk('ay-set')
    await call(owner, 'attach_ayah', { event_slug: 'ay-set', surah: 105, ayah: 1, ayahTo: 2 })
    const r = await call(owner, 'set_ayah_placement', { event_slug: 'ay-set', ayah_ref: '105:1-2', placement: 'in_summary', after_index: 1, placement_note: { bn: 'আবরাহার কাহিনীর প্রসঙ্গে।' } })
    expect(r.isError).toBe(false)
    expect(r.json).toMatchObject({ ayat: ['105:1', '105:2'], placement: 'in_summary', after_index: 1 })
    expect(await ayat('ay-set')).toMatchObject([{ ref: '105:1', placement: 'in_summary', after_index: 1, placement_note: { bn: 'আবরাহার কাহিনীর প্রসঙ্গে।' } }, { ref: '105:2', placement: 'in_summary', after_index: 1, placement_note: {} }])
    expect((await call(owner, 'set_ayah_placement', { event_slug: 'ay-set', ayah_ref: '105:1', placement: 'in_summary', after_index: 7 })).text).toMatch(/valid after_index 0–2/)
    expect((await call(owner, 'set_ayah_placement', { event_slug: 'ay-set', ayah_ref: '105:4', placement: 'hero' })).text).toMatch(/not attached/)
    expect((await call(owner, 'set_ayah_placement', { event_slug: 'ay-set', ayah_ref: '105:1', placement: 'gallery' })).isError).toBe(true)
    expect((await call(owner, 'set_ayah_placement', { event_slug: 'ay-set', ayah_ref: 'not a ref', placement: 'hero' })).isError).toBe(true)
    await call(owner, 'set_ayah_placement', { event_slug: 'ay-set', ayah_ref: '105:1', placement: 'hero', placement_note: null })
    expect((await ayat('ay-set'))[0]).toMatchObject({ placement: 'hero', after_index: null, placement_note: {} }) // moving out of an indexed slot clears the index; null clears the note
    await call(owner, 'set_ayah_placement', { event_slug: 'ay-set', ayah_ref: '105:2', placement: 'end' })
    expect((await ayat('ay-set'))[1]!.placement_note).toEqual({}) // omitting the note leaves notes alone (there was none)
  })
  it('revert_revision restores the previous placement and note', async () => {
    await mk('ay-rev')
    await attach('ay-rev', { placement: 'in_key_details', after_index: 0, placement_note: { bn: 'প্রথম বিবরণের সাথে মিল।' } })
    await call(owner, 'set_ayah_placement', { event_slug: 'ay-rev', ayah_ref: '96:1', placement: 'end', placement_note: null })
    const rev = (await call(owner, 'list_revisions', { event_slug: 'ay-rev' })).json.revisions.find((r: any) => r.action === 'set_ayah_placement')
    expect((await call(owner, 'revert_revision', { revision_id: rev.revision_id })).isError).toBe(false)
    expect((await ayat('ay-rev'))[0]).toMatchObject({ placement: 'in_key_details', after_index: 0, placement_note: { bn: 'প্রথম বিবরণের সাথে মিল।' } })
  })
  it('detach removes the ayah and its note', async () => {
    await mk('ay-det')
    await attach('ay-det', { placement_note: { bn: 'একটি বাক্য।' } })
    expect((await call(owner, 'detach_ayah', { event_slug: 'ay-det', surah: 96, ayah: 1 })).isError).toBe(false)
    expect(await ayat('ay-det')).toEqual([])
    expect((await db().select().from(s.eventAyatNotes)).filter((n) => n.eventId === (undefined as never))).toEqual([])
  })
})

describe('ayat and pictures share slots', () => {
  const png = b64(pngBytes(300, 200))
  const up = (slug: string, extra: object) => call(owner, 'upload_media', { event_slug: slug, kind: 'pattern', alt: { bn: 'নকশা' }, contains_people_confirmation: false, base64: png, ...extra })
  it('order counts both kinds: the next item in a slot goes after what is there, whatever its kind', async () => {
    await mk('ay-mix')
    await attach('ay-mix', { placement: 'in_key_details', after_index: 0 })
    await up('ay-mix', { placement: 'in_key_details', after_index: 0 })
    await attach('ay-mix', { ayah: 2, placement: 'in_key_details', after_index: 0 })
    const g = (await call(owner, 'get_event', { slug: 'ay-mix' })).json
    expect(g.ayat.map((a: any) => a.order)).toEqual([0, 2])
    expect(g.media[0].order).toBe(1)
    const lay = await layout('ay-mix')
    expect(lay.slots.key_details[0].placed_after.map((x: any) => x.ref ?? x.media_id.slice(0, 4))).toHaveLength(3)
    expect(lay.slots.key_details[0].placed_after.map((x: any) => x.kind)).toEqual(['ayah', 'media', 'ayah'])
  })
  it('nextSlotOrder (pure) looks at both and ignores other slots and the item being moved', () => {
    const agg = {
      ayat: [{ ayahId: '1:1', placement: 'hero', afterIndex: null, orderIndex: 1000 }, { ayahId: '1:2', placement: 'in_summary', afterIndex: 1, orderIndex: 4 }],
      media: [{ media: { id: 'm1', placement: 'in_summary', afterIndex: 1, orderIndex: 7 } }, { media: { id: 'm2', placement: 'in_summary', afterIndex: 0, orderIndex: 99 } }],
    } as never
    expect(nextSlotOrder(agg, 'in_summary', 1)).toBe(8)
    expect(nextSlotOrder(agg, 'in_summary', 1, { kind: 'media', id: 'm1' })).toBe(5)
    expect(nextSlotOrder(agg, 'in_summary', 2)).toBe(0)
    expect(nextSlotOrder(agg, 'hero', null)).toBe(1001)
  })
})

describe('get_event_layout', () => {
  it('lists numbered paragraphs, key details and lessons with their first ~80 characters, plus the fixed slots', async () => {
    await mk('ay-lay', { summary: 'ক'.repeat(200) + '\n\nদ্বিতীয়।', lessons: ['একমাত্র শিক্ষা'] })
    const l = await layout('ay-lay')
    expect(l).toMatchObject({ event: 'ay-lay', counts: { summary_paragraphs: 2, key_details: 3, lessons: 1 } })
    expect(l.slots.summary.map((x: any) => x.after_index)).toEqual([0, 1])
    expect(l.slots.summary[0].text.length).toBeLessThanOrEqual(81)
    expect(l.slots.summary[0].text.endsWith('…')).toBe(true)
    expect(l.slots.key_details.map((x: any) => x.text)).toEqual(KD)
    expect(l.slots.lessons.map((x: any) => x.text)).toEqual(['একমাত্র শিক্ষা'])
    for (const k of ['hero', 'after_summary', 'before_lessons', 'end', 'gallery']) expect(l.slots[k]).toEqual([])
    expect(l.how_to_use).toMatch(/Explain the choice to the owner/)
    expect(l.page_order.length).toBe(9)
  })
  it('shows what is placed where, with the note and the picture\'s alt text', async () => {
    await mk('ay-lay2')
    await attach('ay-lay2', { placement: 'in_lessons', after_index: 1, placement_note: { bn: 'শিক্ষার সাথে সম্পর্ক।' } })
    await up2('ay-lay2')
    const l = await layout('ay-lay2')
    expect(l.slots.lessons[1].placed_after).toEqual([{ kind: 'ayah', ref: '96:1', order: 0, placement_note: 'শিক্ষার সাথে সম্পর্ক।' }])
    expect(l.slots.end).toMatchObject([{ kind: 'media', alt: 'নকশা', image_kind: 'pattern' }])
  })
  async function up2(slug: string) { return call(owner, 'upload_media', { event_slug: slug, kind: 'pattern', alt: { bn: 'নকশা' }, contains_people_confirmation: false, base64: b64(pngBytes(300, 200)), placement: 'end' }) }

  it('an ayah whose slot no longer exists is listed for review and shown at the end of its section', async () => {
    await mk('ay-orph')
    await attach('ay-orph', { placement: 'in_key_details', after_index: 2 })
    await attach('ay-orph', { ayah: 2, placement: 'in_summary', after_index: 2 })
    const upd = await call(owner, 'update_event', { slug: 'ay-orph', translation: { lang: 'bn', key_details: ['একটি'], summary: 'শুধু একটি অনুচ্ছেদ।' } })
    expect(upd.json.needs_placement_review).toHaveLength(2)
    const g = (await call(owner, 'get_event', { slug: 'ay-orph' })).json
    expect(g.needs_placement_review).toMatchObject([
      { kind: 'ayah', id: '96:1', placement: 'in_key_details', after_index: 2, section: 'key_details', langs: [{ lang: 'bn', count: 1 }] },
      { kind: 'ayah', id: '96:2', placement: 'in_summary', after_index: 2, section: 'summary', langs: [{ lang: 'bn', count: 1 }] },
    ])
    const l = await layout('ay-orph')
    expect(l.slots.key_details[0].placed_after).toMatchObject([{ ref: '96:1', needs_review: true }])
    expect(l.slots.summary[0].placed_after).toMatchObject([{ ref: '96:2', needs_review: true }])
    expect(g.publish_blockers.join()).not.toMatch(/placement/)
    await call(owner, 'set_ayah_placement', { event_slug: 'ay-orph', ayah_ref: '96:1', placement: 'in_key_details', after_index: 0 })
    expect((await call(owner, 'get_event', { slug: 'ay-orph' })).json.needs_placement_review).toHaveLength(1)
  })
  it('when a whole section is emptied its items fall back to the neighbouring fixed slot', async () => {
    await mk('ay-empty')
    await attach('ay-empty', { placement: 'in_lessons', after_index: 0 })
    await call(owner, 'update_event', { slug: 'ay-empty', translation: { lang: 'bn', lessons: [] } })
    const l = await layout('ay-empty')
    expect(l.slots.end).toMatchObject([{ ref: '96:1', needs_review: true }])
  })
  it('review is per language: a translation with fewer paragraphs flags the item for that language only', async () => {
    await mk('ay-lang')
    await attach('ay-lang', { placement: 'in_key_details', after_index: 2 })
    await call(owner, 'add_translation', { slug: 'ay-lang', translation: { lang: 'en', title: 'Lang', summary: 'One paragraph.', key_details: ['only one'], lessons: [] } })
    const g = (await call(owner, 'get_event', { slug: 'ay-lang' })).json
    expect(g.needs_placement_review).toMatchObject([{ id: '96:1', langs: [{ lang: 'en', count: 1 }] }])
  })
})

describe('the MCP gives AIs the context (guidelines, prompt, tool list)', () => {
  it('tools/list includes the new tools and the guidelines resource tells the AI to read the layout first', async () => {
    const { rpc } = await import('./helpers')
    const names: string[] = (await rpc(owner, 'tools/list')).body.result.tools.map((t: any) => t.name)
    for (const t of ['get_event_layout', 'set_ayah_placement', 'create_upload_url', 'create_upload_link', 'upload_media_begin', 'upload_media_chunk', 'upload_media_finish']) expect(names, t).toContain(t)
    const res = await rpc(owner, 'resources/read', { uri: 'seerah://content-guidelines' })
    const text: string = res.body.result.contents[0].text
    expect(text).toMatch(/call \*\*get_event_layout\*\*/)
    expect(text).toMatch(/Explain the choice to the owner before saving/)
    expect(text).toMatch(/Never dump everything in one place/)
    expect(text).toMatch(/NEVER Banglish or romanized Bangla/)
    expect(text).toMatch(/placement_note/)
    expect(text).toMatch(/\(আ\.\).*\(রা\.\)/s)
    const p = await rpc(owner, 'prompts/get', { name: 'place_ayat_and_media', arguments: { event_slug: 'ay-1', items: '96:1 and a map of Makkah' } })
    const pt: string = p.body.result.messages[0].content.text
    expect(pt).toMatch(/get_event_layout/)
    expect(pt).toMatch(/WAIT/)
    expect(pt).toMatch(/preview_event/)
    expect(pt).toContain('ay-1')
  })
  it('uploading a picture needs no database edit by hand: the whole chain is tools', async () => {
    const { rpc } = await import('./helpers')
    const list = (await rpc(owner, 'tools/list')).body.result.tools as { name: string; description: string }[]
    const desc = Object.fromEntries(list.map((t) => [t.name, t.description]))
    expect(desc.upload_media).toMatch(/media_url/)
    expect(desc.upload_media).toMatch(/Wikimedia Commons/)
    expect(desc.upload_media).toMatch(/SMALL images/)
    expect(desc.create_upload_link).toMatch(/Bangla/)
    expect(desc.create_upload_url).toMatch(/SINGLE-USE/)
    expect(desc.upload_media_begin).toMatch(/32768/)
  })
})
