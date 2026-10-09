import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import { call, db, makeToken, seedEra } from './helpers'
import { purgeDeleted, RESTORE_DAYS } from '../src/purge'

let owner: string, editor: string
const T = { lang: 'bn', title: 'x', summary: 'মুহাম্মাদ ﷺ-এর জীবনের একটি ঘটনা।\n\nদ্বিতীয় অনুচ্ছেদ।' }
const mk = (slug: string) => call(owner, 'create_event_draft', { slug, era_slug: 'makkan-early', translation: { ...T, title: 'ঘটনা ' + slug }, hijri_year: -10 })
const ready = async (slug: string) => {
  await mk(slug)
  await call(owner, 'set_certainty', { slug, certainty: 'agreed' })
  await call(owner, 'set_primary_place', { event_slug: slug, place_slug: 'st-place' })
}
const ev = async (slug: string) => (await call(owner, 'get_event', { slug })).json
const evRow = async (slug: string) => (await db().select().from(s.events).where(eq(s.events.slug, slug)))[0]
const cite = (slug: string, o: object) => call(owner, 'add_source_citation', { event_slug: slug, source_slug: 'st-book', ...o })

beforeAll(async () => {
  await seedEra()
  owner = await makeToken('owner-user', 'owner')
  editor = await makeToken('editor-user', 'editor')
  await call(owner, 'create_place', { slug: 'st-place', type: 'city', lat: 21.4, lng: 39.8, names: { bn: 'স্থান' } })
  await call(owner, 'create_source', { slug: 'st-book', book: 'বই', author: 'লেখক' })
})

describe('sources: ayah / hadith / citation', () => {
  it('an attached ayah alone satisfies the source rule and the event publishes', async () => {
    await ready('st-ayah')
    expect((await call(owner, 'publish_event', { slug: 'st-ayah' })).text).toMatch(/At least one source/)
    expect((await call(owner, 'attach_ayah', { event_slug: 'st-ayah', surah: 96, ayah: 1 })).isError).toBe(false)
    expect((await ev('st-ayah')).publish_blockers).toEqual([])
    expect((await call(owner, 'publish_event', { slug: 'st-ayah' })).isError).toBe(false)
  })
  it('invalid citation + valid hadith ref publishes with a warning; the warning names the citation and the tools', async () => {
    await ready('st-warn')
    const e = (await ev('st-warn'))
    await db().insert(s.eventSources).values({ id: 'st-bad-citation-id', eventId: (await evRow('st-warn'))!.id, sourceId: (await db().select().from(s.sources).where(eq(s.sources.slug, 'st-book')))[0]!.id, page: 'hadith no. 3364' })
    expect(e.publish_blockers.join(' ')).toMatch(/source/) // still blocked before the hadith is there
    expect((await call(owner, 'attach_hadith_ref', { event_slug: 'st-warn', collection: 'Sahih al-Bukhari', number: '3364', grading: 'Sahih', note: 'Ibn Abbas (রা.); Kitab Ahadith al-Anbiya' })).isError).toBe(false)
    const g = await ev('st-warn')
    expect(g.publish_blockers).toEqual([])
    expect(g.publish_warnings[0]).toMatch(/st-bad-citation-id.*update_source_citation.*remove_source_citation/)
    expect(g.hadith[0].hadith_ref_id).toBeTruthy()
    const p = await call(owner, 'publish_event', { slug: 'st-warn' })
    expect(p.isError).toBe(false); expect(p.json.warnings).toHaveLength(1)
  })
  it('the sole invalid citation blocks with its id and the fixing tools; update_source_citation fixes it', async () => {
    await ready('st-fix')
    await db().insert(s.eventSources).values({ id: 'st-fix-bad-citation', eventId: (await evRow('st-fix'))!.id, sourceId: (await db().select().from(s.sources).where(eq(s.sources.slug, 'st-book')))[0]!.id, page: 'tbd' })
    const r = await call(owner, 'publish_event', { slug: 'st-fix' })
    expect(r.isError).toBe(true); expect(r.text).toMatch(/Citation id st-fix-bad-citation.*update_source_citation/s)
    expect((await call(owner, 'update_source_citation', { event_slug: 'st-fix', citation_id: 'st-fix-bad-citation', page: 'n/a' })).text).toMatch(/placeholder/)
    expect((await call(owner, 'update_source_citation', { event_slug: 'st-fix', citation_id: 'st-fix-bad-citation', page: null })).text).toMatch(/no locator/)
    const u = await call(owner, 'update_source_citation', { event_slug: 'st-fix', citation_id: 'st-fix-bad-citation', page: '118–119', volume: '1' })
    expect(u.isError).toBe(false); expect(u.json.after).toEqual({ volume: '1', page: '118–119', section: null })
    expect((await call(owner, 'update_source_citation', { event_slug: 'st-fix', citation_id: 'st-fix-bad-citation', page: null, section: 'ওহীর সূচনা অধ্যায়' })).json.after).toEqual({ volume: '1', page: null, section: 'ওহীর সূচনা অধ্যায়' })
    expect((await ev('st-fix')).publish_blockers).toEqual([])
    expect((await call(owner, 'update_source_citation', { event_slug: 'st-fix', citation_id: 'nope-nope-nope', page: '1' })).text).toMatch(/No citation/)
  })
  it('remove_source_citation and detach_hadith_ref remove them (revertible), only from this event', async () => {
    await mk('st-rm'); await mk('st-rm2')
    const c = await cite('st-rm', { page: '5' }); const id = c.json.citation_id
    await cite('st-rm2', { page: '6' })
    expect((await call(owner, 'remove_source_citation', { event_slug: 'st-rm2', citation_id: id })).text).toMatch(/No citation/) // another event's citation
    const r = await call(owner, 'remove_source_citation', { event_slug: 'st-rm', citation_id: id })
    expect(r.isError).toBe(false); expect((await ev('st-rm')).sources).toEqual([])
    expect((await ev('st-rm2')).sources).toHaveLength(1)
    expect((await call(owner, 'revert_revision', { revision_id: r.json.revision_id })).isError).toBe(false)
    expect((await ev('st-rm')).sources).toHaveLength(1)
    await call(owner, 'attach_hadith_ref', { event_slug: 'st-rm', collection: 'Sahih Muslim', number: '1', grading: 'Sahih' })
    const hid = (await ev('st-rm')).hadith[0].hadith_ref_id
    expect((await call(owner, 'detach_hadith_ref', { event_slug: 'st-rm2', hadith_ref_id: hid })).text).toMatch(/No hadith reference/)
    expect((await call(owner, 'detach_hadith_ref', { event_slug: 'st-rm', hadith_ref_id: hid })).isError).toBe(false)
    expect((await ev('st-rm')).hadith).toEqual([])
    expect((await db().select().from(s.hadithRefs).where(eq(s.hadithRefs.id, hid))).length).toBe(1) // the record stays for other events
  })
  it('editors may fix drafts but not published events (owner only)', async () => {
    await mk('st-ed')
    const c = await cite('st-ed', { page: '7' })
    expect((await call(editor, 'update_source_citation', { event_slug: 'st-ed', citation_id: c.json.citation_id, page: '8' })).isError).toBe(false)
    const pub = (await ev('st-ayah')).sources
    expect(pub).toEqual([]) // st-ayah has no citation: use st-warn's
    const w = (await ev('st-warn')).sources[0].citation_id
    expect((await call(editor, 'remove_source_citation', { event_slug: 'st-warn', citation_id: w })).text).toMatch(/editors can only modify drafts/)
    expect((await call(editor, 'update_source_citation', { event_slug: 'st-warn', citation_id: w, page: '9' })).text).toMatch(/editors can only modify drafts/)
    const h = (await ev('st-warn')).hadith[0].hadith_ref_id
    expect((await call(editor, 'detach_hadith_ref', { event_slug: 'st-warn', hadith_ref_id: h })).text).toMatch(/editors can only modify drafts/)
    expect((await call(owner, 'remove_source_citation', { event_slug: 'st-warn', citation_id: w })).isError).toBe(false)
  })
})

describe('delete_draft', () => {
  it('is owner only, needs the exact slug, and refuses published events (pointing to unpublish_event)', async () => {
    await mk('del-a')
    expect((await call(editor, 'delete_draft', { event_slug: 'del-a', confirm_slug: 'del-a' })).text).toMatch(/owner/i)
    expect((await call(owner, 'delete_draft', { event_slug: 'del-a', confirm_slug: 'del-b' })).text).toMatch(/does not match/)
    expect((await call(owner, 'delete_draft', { event_slug: 'del-a', confirm_slug: 'DEL-A' })).isError).toBe(true)
    expect(await evRow('del-a')).toBeTruthy()
    expect((await call(owner, 'delete_draft', { event_slug: 'st-ayah', confirm_slug: 'st-ayah' })).text).toMatch(/unpublish_event/)
    expect(await evRow('st-ayah')).toBeTruthy()
  })
  it('refuses a draft that was published before (unpublished again)', async () => {
    await call(owner, 'unpublish_event', { slug: 'st-ayah' })
    const r = await call(owner, 'delete_draft', { event_slug: 'st-ayah', confirm_slug: 'st-ayah' })
    expect(r.isError).toBe(true); expect(r.text).toMatch(/published before/)
    expect(await evRow('st-ayah')).toBeTruthy()
  })
  it('soft-deletes with everything, lists it as recently deleted, and revert_revision restores it with its picture', async () => {
    await ready('del-full')
    await cite('del-full', { page: '3' })
    await call(owner, 'attach_ayah', { event_slug: 'del-full', surah: 96, ayah: 2 })
    await call(owner, 'attach_hadith_ref', { event_slug: 'del-full', collection: 'Sahih al-Bukhari', number: '3', grading: 'Sahih' })
    const id = (await evRow('del-full'))!.id
    await env.MEDIA.put('media/del-full-pic.png', new Uint8Array([1, 2, 3]))
    await db().insert(s.media).values({ id: 'del-full-pic-id', r2Key: 'media/del-full-pic.png', kind: 'pattern', mime: 'image/png', bytes: 3, eventId: id, placement: 'end', orderIndex: 0 })
    await db().insert(s.mediaAlt).values({ mediaId: 'del-full-pic-id', lang: 'bn', alt: 'নকশা' })
    const before = await ev('del-full')

    const d = await call(owner, 'delete_draft', { event_slug: 'del-full', confirm_slug: 'del-full' })
    expect(d.isError).toBe(false); expect(d.json.restore_with).toMatch(/revert_revision/)
    expect(await evRow('del-full')).toBeUndefined()
    expect((await call(owner, 'get_event', { slug: 'del-full' })).isError).toBe(true)
    expect((await call(owner, 'search_events', { query: 'del-full' })).text).not.toMatch(/"del-full"/)
    expect(await env.MEDIA.get('media/del-full-pic.png')).not.toBeNull() // file kept for the restore window

    const list = (await call(owner, 'list_drafts', {})).json
    expect(list.drafts.map((x: any) => x.slug)).not.toContain('del-full')
    const rd = list.recently_deleted.find((x: any) => x.slug === 'del-full')
    expect(rd.label).toMatch(/recently deleted \(restorable until \d{4}-\d{2}-\d{2}\)/)
    expect(new Date(rd.restorable_until).getTime() - Date.now()).toBeGreaterThan((RESTORE_DAYS - 1) * 86_400_000)

    const rv = await call(owner, 'revert_revision', { revision_id: d.json.revision_id })
    expect(rv.isError).toBe(false)
    const after = await ev('del-full')
    for (const k of ['translation', 'sources', 'ayat', 'hadith', 'places'] as const) expect(after[k], k).toEqual(before[k])
    expect(after.media).toHaveLength(1)
    expect((await call(owner, 'list_drafts', {})).json.recently_deleted.map((x: any) => x.slug)).not.toContain('del-full')
    expect((await call(owner, 'revert_revision', { revision_id: d.json.revision_id })).text).toMatch(/already reverted/)
  })
  it('restore: owner only, and not when the slug has been taken meanwhile', async () => {
    await mk('del-slug')
    const d = await call(owner, 'delete_draft', { event_slug: 'del-slug', confirm_slug: 'del-slug' })
    expect((await call(editor, 'revert_revision', { revision_id: d.json.revision_id })).text).toMatch(/owner/i)
    await call(owner, 'create_event_draft', { slug: 'del-slug', era_slug: 'makkan-early', translation: { ...T, title: 'সম্পূর্ণ আলাদা শিরোনাম' } })
    expect((await call(owner, 'revert_revision', { revision_id: d.json.revision_id })).text).toMatch(/exists now/)
  })
})

describe('purge after 30 days', () => {
  it('purges unrestored deleted drafts older than 30 days (files + history), keeps newer ones, restores stop working', async () => {
    await mk('pg-old'); await mk('pg-new')
    const oldId = (await evRow('pg-old'))!.id
    await env.MEDIA.put('media/pg-old.png', new Uint8Array([1]))
    await db().insert(s.media).values({ id: 'pg-old-id', r2Key: 'media/pg-old.png', kind: 'pattern', mime: 'image/png', bytes: 1, eventId: oldId, variants: { '480': 'media/pg-old-480.webp' } })
    await env.MEDIA.put('media/pg-old-480.webp', new Uint8Array([1]))
    const dOld = await call(owner, 'delete_draft', { event_slug: 'pg-old', confirm_slug: 'pg-old' })
    const dNew = await call(owner, 'delete_draft', { event_slug: 'pg-new', confirm_slug: 'pg-new' })
    // 29 days later: nothing is purged
    const day = 86_400_000
    const r29 = await purgeDeleted(env, new Date(Date.now() + 29 * day))
    expect(r29.drafts).toBe(0); expect(await env.MEDIA.get('media/pg-old.png')).not.toBeNull()
    // make pg-old 31 days old
    await db().update(s.revisions).set({ createdAt: new Date(Date.now() - 31 * day).toISOString() }).where(eq(s.revisions.id, dOld.json.revision_id))
    const r = await purgeDeleted(env)
    expect(r.drafts).toBe(1); expect(r.files).toBe(2)
    expect(await env.MEDIA.get('media/pg-old.png')).toBeNull(); expect(await env.MEDIA.get('media/pg-old-480.webp')).toBeNull()
    expect((await db().select().from(s.revisions).where(eq(s.revisions.entityId, oldId))).map((x) => x.action)).toEqual(['delete_draft_purged'])
    expect((await call(owner, 'revert_revision', { revision_id: dOld.json.revision_id })).isError).toBe(true) // gone
    // the newer one is untouched and still restorable
    expect((await call(owner, 'list_drafts', {})).json.recently_deleted.map((x: any) => x.slug)).toContain('pg-new')
    expect((await call(owner, 'revert_revision', { revision_id: dNew.json.revision_id })).isError).toBe(false)
    expect((await purgeDeleted(env)).drafts).toBe(0) // idempotent
  })
  it('also removes expired preview tokens and orphaned old pictures, never recent or referenced ones', async () => {
    const day = 86_400_000
    const id = (await evRow('st-fix'))!.id
    await db().insert(s.previewTokens).values([{ tokenHash: 'pt-expired', eventId: id, expiresAt: new Date(Date.now() - 1000).toISOString(), createdBy: 't' }, { tokenHash: 'pt-live', eventId: id, expiresAt: new Date(Date.now() + day).toISOString(), createdBy: 't' }])
    const orphan = 'media/11111111-1111-1111-1111-111111111111.png'
    await env.MEDIA.put(orphan, new Uint8Array([1]))
    await env.MEDIA.put('media/22222222-2222-2222-2222-222222222222.png', new Uint8Array([1]))
    await db().insert(s.media).values({ id: '22222222-2222-2222-2222-222222222222', r2Key: 'media/22222222-2222-2222-2222-222222222222.png', kind: 'pattern', mime: 'image/png', bytes: 1, eventId: id })
    const now = new Date(Date.now() + 3 * day) // everything in R2 is now > 2 days old
    const r = await purgeDeleted(env, now)
    expect(r.previewTokens).toBeGreaterThanOrEqual(1)
    expect(await env.MEDIA.get(orphan)).toBeNull()
    expect(await env.MEDIA.get('media/22222222-2222-2222-2222-222222222222.png')).not.toBeNull()
    // a fresh orphan (just uploaded, row not yet written) is left alone
    await env.MEDIA.put('media/33333333-3333-3333-3333-333333333333.png', new Uint8Array([1]))
    await purgeDeleted(env)
    expect(await env.MEDIA.get('media/33333333-3333-3333-3333-333333333333.png')).not.toBeNull()
  })
})
