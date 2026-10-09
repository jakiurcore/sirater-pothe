import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import { call, db, makeToken, seedEra } from './helpers'
import { planAddPlace, planRemovePlace, planSetPrimary, type PlaceLink } from '../src/data'
import { imageSize } from '../src/tools/media'

let owner: string, editor: string
const KD = ['প্রথম বিবরণ', 'দ্বিতীয় বিবরণ', 'তৃতীয় বিবরণ']
const T = { lang: 'bn', title: 'জমজম কূপ', summary: 'কূপ পুনরুদ্ধারের বিবরণ।', key_details: KD }
const mk = (slug: string, title = 'শিরোনাম ' + slug, extra: object = {}) =>
  call(owner, 'create_event_draft', { slug, era_slug: 'makkan-early', translation: { ...T, title }, ...extra })
const places = async (slug: string) => (await call(owner, 'get_event', { slug })).json.places as { slug: string; role: string; order: number; zoom: number; type: string; parent: string | null }[]
const primaries = async (slug: string) => (await db().query.eventPlaces.findMany({ where: eq(s.eventPlaces.eventId, (await db().query.events.findFirst({ where: eq(s.events.slug, slug) }))!.id) })).filter((p) => p.role === 'primary')

beforeAll(async () => {
  await seedEra()
  owner = await makeToken('owner-user', 'owner')
  editor = await makeToken('editor-user', 'editor')
  await call(owner, 'create_place', { slug: 'makkah', type: 'city', lat: 21.4225, lng: 39.826, names: { bn: 'মক্কা', en: 'Makkah' } })
  await call(owner, 'create_place', { slug: 'masjid-al-haram', type: 'site', parent_place_slug: 'makkah', lat: 21.4225079, lng: 39.826189, names: { bn: 'মাসজিদুল হারাম' } })
  await call(owner, 'create_place', { slug: 'zamzam', type: 'site', parent_place_slug: 'makkah', lat: 21.422, lng: 39.826, names: { bn: 'জমজম কূপ' } })
  await call(owner, 'create_place', { slug: 'madinah', type: 'city', lat: 24.4686, lng: 39.6111, names: { bn: 'মদিনা' } })
  await call(owner, 'create_place', { slug: 'hijaz', type: 'region', lat: 23, lng: 39, names: { bn: 'হিজাজ' } })
})

describe('place types, parent and zoom', () => {
  it('creates sites with a parent city and reports the zoom by type', async () => {
    const r = await call(owner, 'find_place', { query: 'zamzam' })
    expect(r.json.results[0]).toMatchObject({ slug: 'zamzam', type: 'site', parent: 'makkah', zoom: 17, in_database: true })
    expect((await call(owner, 'find_place', { query: 'makkah' })).json.results.find((x: any) => x.slug === 'makkah')).toMatchObject({ type: 'city', zoom: 12 })
    expect((await call(owner, 'find_place', { query: 'hijaz' })).json.results[0]).toMatchObject({ type: 'region', zoom: 6 })
  })
  it('a zoom override is stored and wins over the type default', async () => {
    const r = await call(owner, 'create_place', { slug: 'badr', type: 'site', lat: 23.73, lng: 38.775, zoom: 13, names: { bn: 'বদর' } })
    expect(r.json).toMatchObject({ type: 'site', zoom: 13 })
    expect((await db().query.places.findFirst({ where: eq(s.places.slug, 'badr') }))!.zoomOverride).toBe(13)
    expect((await call(owner, 'create_place', { slug: 'badr-2', type: 'site', lat: 23.7, lng: 38.7, zoom: 40, names: { bn: 'ক' } })).isError).toBe(true)
  })
  it('rejects old types, unknown parents and a wrong hierarchy', async () => {
    expect((await call(owner, 'create_place', { slug: 'cave-x', type: 'cave', lat: 21.4, lng: 39.8, names: { bn: 'গুহা' } })).text).toMatch(/region, city, site/)
    expect((await call(owner, 'create_place', { slug: 'x1', type: 'site', parent_place_slug: 'nope', lat: 21.4, lng: 39.8, names: { bn: 'ক' } })).text).toMatch(/No place with slug "nope"/)
    expect((await call(owner, 'create_place', { slug: 'x2', type: 'site', parent_place_slug: 'zamzam', lat: 21.4, lng: 39.8, names: { bn: 'ক' } })).text).toMatch(/parent of a site must be a city/)
    expect((await call(owner, 'create_place', { slug: 'x3', type: 'city', parent_place_slug: 'madinah', lat: 24.4, lng: 39.6, names: { bn: 'ক' } })).text).toMatch(/parent of a city must be a region/)
    expect((await call(owner, 'create_place', { slug: 'x4', type: 'region', parent_place_slug: 'hijaz', lat: 23, lng: 39, names: { bn: 'ক' } })).text).toMatch(/region has no parent/)
    expect((await call(owner, 'create_place', { slug: 'madinah-x', type: 'city', parent_place_slug: 'hijaz', lat: 24.4, lng: 39.6, names: { bn: 'ক' } })).isError).toBe(false)
  })
  it('update_place is owner only and keeps the hierarchy valid', async () => {
    expect((await call(editor, 'update_place', { slug: 'badr', parent_place_slug: 'hijaz' })).text).toMatch(/owner/i)
    expect((await call(owner, 'update_place', { slug: 'badr', parent_place_slug: 'madinah' })).isError).toBe(false)
    expect((await call(owner, 'update_place', { slug: 'badr', zoom: null })).json.zoom).toBe(17)
    expect((await call(owner, 'update_place', { slug: 'makkah', type: 'site' })).text).toMatch(/is inside "makkah"/)
    expect((await call(owner, 'update_place', { slug: 'badr' })).isError).toBe(true)
  })
})

describe('several places per event', () => {
  it('create_event_draft place_slug makes that place the primary; events.place_id mirrors it', async () => {
    expect((await mk('ev-one', 'এক', { place_slug: 'makkah' })).isError).toBe(false)
    expect(await places('ev-one')).toMatchObject([{ slug: 'makkah', role: 'primary', zoom: 12, type: 'city' }])
    const ev = await db().query.events.findFirst({ where: eq(s.events.slug, 'ev-one') })
    expect(ev!.placeId).toBe((await db().query.places.findFirst({ where: eq(s.places.slug, 'makkah') }))!.id)
  })

  it('set_primary_place adds the place, demotes the old primary to related, and stays exactly one primary', async () => {
    const r = await call(owner, 'set_primary_place', { event_slug: 'ev-one', place_slug: 'zamzam' })
    expect(r.isError).toBe(false)
    expect(await places('ev-one')).toMatchObject([{ slug: 'zamzam', role: 'primary', order: 0, zoom: 17, parent: 'makkah' }, { slug: 'makkah', role: 'related', order: 1 }])
    expect((await primaries('ev-one')).length).toBe(1)
    expect((await db().query.events.findFirst({ where: eq(s.events.slug, 'ev-one') }))!.placeId).toBe((await db().query.places.findFirst({ where: eq(s.places.slug, 'zamzam') }))!.id)
    // choosing an already-related place promotes it
    await call(owner, 'set_primary_place', { event_slug: 'ev-one', place_slug: 'makkah' })
    expect((await places('ev-one')).map((p) => [p.slug, p.role])).toEqual([['makkah', 'primary'], ['zamzam', 'related']])
  })

  it('add_event_place: related, one route_start and one route_end, no duplicates, no primary via add', async () => {
    await call(owner, 'set_primary_place', { event_slug: 'ev-one', place_slug: 'zamzam' })
    expect((await call(owner, 'add_event_place', { event_slug: 'ev-one', place_slug: 'masjid-al-haram' })).isError).toBe(false)
    expect((await places('ev-one')).map((p) => [p.slug, p.role])).toEqual([['zamzam', 'primary'], ['makkah', 'related'], ['masjid-al-haram', 'related']])
    expect((await call(owner, 'add_event_place', { event_slug: 'ev-one', place_slug: 'masjid-al-haram' })).text).toMatch(/already linked as "related"/)
    expect((await call(owner, 'add_event_place', { event_slug: 'ev-one', place_slug: 'zamzam', role: 'related' })).text).toMatch(/set_primary_place/)
    expect((await call(owner, 'add_event_place', { event_slug: 'ev-one', place_slug: 'madinah', role: 'primary' })).isError).toBe(true)
    expect((await call(owner, 'add_event_place', { event_slug: 'ev-one', place_slug: 'madinah', role: 'route_end' })).isError).toBe(false)
    expect((await call(owner, 'add_event_place', { event_slug: 'ev-one', place_slug: 'hijaz', role: 'route_end' })).text).toMatch(/already has a "route_end"/)
    expect((await primaries('ev-one')).length).toBe(1)
  })

  it('get_event returns every place with its role, zoom and parent, and `place` is the primary', async () => {
    const g = (await call(owner, 'get_event', { slug: 'ev-one' })).json
    expect(g.places.map((p: any) => p.role)).toEqual(['primary', 'related', 'related', 'route_end'])
    expect(g.places[0]).toMatchObject({ slug: 'zamzam', zoom: 17, parent: 'makkah', verified: false })
    expect(g.place.slug).toBe('zamzam')
    expect(g.places[0].names.bn).toBe('জমজম কূপ')
  })

  it('remove_event_place unlinks a related place but keeps the place itself', async () => {
    expect((await call(owner, 'remove_event_place', { event_slug: 'ev-one', place_slug: 'madinah' })).isError).toBe(false)
    expect((await places('ev-one')).map((p) => p.slug)).toEqual(['zamzam', 'makkah', 'masjid-al-haram'])
    expect(await db().query.places.findFirst({ where: eq(s.places.slug, 'madinah') })).toBeTruthy()
    expect((await call(owner, 'remove_event_place', { event_slug: 'ev-one', place_slug: 'madinah' })).text).toMatch(/not linked/)
  })

  it('publishing needs EXACTLY one primary place', async () => {
    await mk('ev-pub', 'প্রকাশ', {})
    await call(owner, 'create_source', { slug: 'src-p', book: 'বই', author: 'লেখক' })
    await call(owner, 'add_source_citation', { event_slug: 'ev-pub', source_slug: 'src-p', page: '1' })
    const none = await call(owner, 'publish_event', { slug: 'ev-pub' })
    expect(none.text).toMatch(/No primary place/)
    expect((await call(owner, 'get_event', { slug: 'ev-pub' })).json.publish_blockers.join()).toMatch(/set_primary_place/)
    await call(owner, 'add_event_place', { event_slug: 'ev-pub', place_slug: 'makkah' })
    expect((await call(owner, 'publish_event', { slug: 'ev-pub' })).text).toMatch(/No primary place/) // related is not primary
    await call(owner, 'set_primary_place', { event_slug: 'ev-pub', place_slug: 'zamzam' })
    expect((await call(owner, 'publish_event', { slug: 'ev-pub' })).isError).toBe(false)
  })

  it('the database itself refuses a second primary (even if a tool had a bug)', async () => {
    const id = (await db().query.events.findFirst({ where: eq(s.events.slug, 'ev-pub') }))!.id
    const other = (await db().query.places.findFirst({ where: eq(s.places.slug, 'madinah') }))!.id
    await expect(db().insert(s.eventPlaces).values({ eventId: id, placeId: other, role: 'primary', orderIndex: 9 })).rejects.toThrow()
  })

  it('a published event keeps its primary: remove is refused, replacing works (editors cannot touch it at all)', async () => {
    expect((await call(owner, 'remove_event_place', { event_slug: 'ev-pub', place_slug: 'zamzam' })).text).toMatch(/must keep exactly one primary/)
    expect((await call(owner, 'update_event', { slug: 'ev-pub', patch: { place_slug: null } })).text).toMatch(/must keep exactly one primary/)
    expect((await call(editor, 'set_primary_place', { event_slug: 'ev-pub', place_slug: 'makkah' })).text).toMatch(/editors can only modify drafts/)
    const r = await call(owner, 'set_primary_place', { event_slug: 'ev-pub', place_slug: 'masjid-al-haram' })
    expect(r.isError).toBe(false)
    expect(r.json.live).toMatch(/already live/)
    expect((await primaries('ev-pub')).length).toBe(1)
  })

  it('editors can manage places on drafts; update_event place_slug (set / clear) goes through event_places', async () => {
    expect((await call(editor, 'add_event_place', { event_slug: 'ev-one', place_slug: 'hijaz' })).isError).toBe(false)
    expect((await call(owner, 'update_event', { slug: 'ev-one', patch: { place_slug: 'madinah' } })).isError).toBe(false)
    expect((await places('ev-one'))[0]).toMatchObject({ slug: 'madinah', role: 'primary' })
    expect((await call(owner, 'update_event', { slug: 'ev-one', patch: { place_slug: null } })).isError).toBe(false)
    expect((await primaries('ev-one')).length).toBe(0)
    expect((await db().query.events.findFirst({ where: eq(s.events.slug, 'ev-one') }))!.placeId).toBeNull()
  })

  it('revert_revision restores the places an event had before the change', async () => {
    await mk('ev-rev', 'রিভার্ট', { place_slug: 'makkah' })
    await call(owner, 'set_primary_place', { event_slug: 'ev-rev', place_slug: 'zamzam' })
    const rev = (await call(owner, 'list_revisions', { event_slug: 'ev-rev' })).json.revisions.find((r: any) => r.action === 'set_primary_place')
    expect((await call(owner, 'revert_revision', { revision_id: rev.revision_id })).isError).toBe(false)
    expect((await places('ev-rev')).map((p) => [p.slug, p.role])).toEqual([['makkah', 'primary']])
    expect((await db().query.events.findFirst({ where: eq(s.events.slug, 'ev-rev') }))!.placeId).toBe((await db().query.places.findFirst({ where: eq(s.places.slug, 'makkah') }))!.id)
  })
})

describe('place planning (pure)', () => {
  const L = (...a: [string, PlaceLink['role']][]): PlaceLink[] => a.map(([placeId, role], orderIndex) => ({ placeId, role, orderIndex }))
  it('planSetPrimary keeps one primary, demotes the old one, preserves the order of the rest', () => {
    const r = planSetPrimary(L(['a', 'primary'], ['b', 'related'], ['c', 'route_start']), 'c')
    expect(r.map((x) => [x.placeId, x.role])).toEqual([['c', 'primary'], ['a', 'related'], ['b', 'related']])
    expect(r.filter((x) => x.role === 'primary').length).toBe(1)
    expect(r.map((x) => x.orderIndex)).toEqual([0, 1, 2])
  })
  it('planAddPlace refuses duplicates and second route ends; clamps order below the primary', () => {
    expect(() => planAddPlace(L(['a', 'primary']), 'a', 'related')).toThrow(/already linked/)
    expect(() => planAddPlace(L(['a', 'primary'], ['b', 'route_end']), 'c', 'route_end')).toThrow(/only one/)
    expect(planAddPlace(L(['a', 'primary'], ['b', 'related']), 'c', 'related', 0).map((x) => x.placeId)).toEqual(['a', 'c', 'b'])
  })
  it('planRemovePlace', () => {
    expect(() => planRemovePlace(L(['a', 'primary']), 'zz', 'draft')).toThrow(/not linked/)
    expect(() => planRemovePlace(L(['a', 'primary']), 'a', 'published')).toThrow(/primary/)
    expect(planRemovePlace(L(['a', 'primary'], ['b', 'related']), 'a', 'draft')).toEqual([{ placeId: 'b', role: 'related', orderIndex: 0 }])
  })
})

// ───────────────────────── media placement ─────────────────────────
const png = (w = 8, h = 6) => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h)
  return b
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const up = (extra: object = {}) => call(owner, 'upload_media', { kind: 'landscape', mime: 'image/png', alt: { bn: 'পাহাড়ের দৃশ্য' }, contains_people_confirmation: false, base64: b64(png(1200, 800)), event_slug: 'ev-media', ...extra })
const mediaOf = async (slug = 'ev-media') => (await call(owner, 'get_event', { slug })).json.media as { media_id: string; placement: string; after_key_detail_index: number | null; order: number; width: number | null; height: number | null; alt: string; caption: string | null; credit: string | null }[]

describe('media placement', () => {
  beforeAll(async () => { await mk('ev-media', 'ছবির ঘটনা') })

  it('defaults to gallery and records the image size and credit/caption', async () => {
    const r = await up({ caption: { bn: 'শিরোনাম' }, credit: 'ছবি: নমুনা (CC BY-SA 4.0)' })
    expect(r.isError).toBe(false)
    expect(r.json).toMatchObject({ placement: 'gallery', width: 1200, height: 800 })
    expect(await mediaOf()).toMatchObject([{ placement: 'gallery', width: 1200, height: 800, caption: 'শিরোনাম', credit: 'ছবি: নমুনা (CC BY-SA 4.0)', alt: 'পাহাড়ের দৃশ্য', order: 0 }])
  })

  it('accepts every placement; in_key_details needs an index that exists', async () => {
    for (const placement of ['hero', 'after_summary', 'before_lessons', 'gallery'])
      expect((await up({ placement })).isError, placement).toBe(false)
    expect((await up({ placement: 'in_key_details' })).text).toMatch(/needs after_key_detail_index/)
    expect((await up({ placement: 'in_key_details', after_key_detail_index: 3 })).text).toMatch(/does not exist: the event has 3 key details \(valid indexes 0–2\)/)
    expect((await up({ placement: 'in_key_details', after_key_detail_index: 2 })).isError).toBe(false)
    expect((await up({ placement: 'hero', after_key_detail_index: 0 })).text).toMatch(/only applies to placement "in_key_details"/)
    expect((await up({ placement: 'footer' })).text).toMatch(/placement must be one of/)
    const m = await mediaOf()
    expect(m.find((x) => x.placement === 'in_key_details')).toMatchObject({ after_key_detail_index: 2 })
  })

  it('an event with no key details cannot take an in_key_details picture', async () => {
    await call(owner, 'create_event_draft', { slug: 'ev-nokd', era_slug: 'makkan-early', translation: { lang: 'bn', title: 'বিবরণহীন', summary: 'সারাংশ।' } })
    expect((await up({ event_slug: 'ev-nokd', placement: 'in_key_details', after_key_detail_index: 0 })).text).toMatch(/no key_details yet/)
  })

  it('order within a placement increases by itself and can be set', async () => {
    const a = await up({ placement: 'hero' }), b = await up({ placement: 'hero', order: 0 })
    expect(a.isError || b.isError).toBe(false)
    const hero = (await mediaOf()).filter((m) => m.placement === 'hero').map((m) => m.order)
    expect(hero.sort()).toEqual([0, 0, 1])
  })

  it('a caption language needs alt text in that language', async () => {
    expect((await up({ caption: { en: 'Caption' } })).text).toMatch(/needs alt text in "en"/)
  })

  it('placement without an event is refused; attach_media later works and validates', async () => {
    const free = await up({ event_slug: undefined, placement: 'hero' })
    expect(free.text).toMatch(/pass event_slug/)
    const r = await up({ event_slug: undefined })
    expect(r.isError).toBe(false)
    expect(r.json.event).toBeNull()
    const id = r.json.media_id
    expect((await call(owner, 'attach_media', { media_id: id, event_slug: 'ev-media', placement: 'in_key_details', after_key_detail_index: 9 })).text).toMatch(/does not exist/)
    expect((await call(owner, 'attach_media', { media_id: id, event_slug: 'ev-media', placement: 'in_key_details', after_key_detail_index: 0 })).isError).toBe(false)
    expect((await call(owner, 'attach_media', { media_id: id, event_slug: 'ev-media' })).text).toMatch(/already attached/)
    expect((await call(owner, 'attach_media', { media_id: 'nonexistent-id', event_slug: 'ev-media' })).text).toMatch(/No picture/)
  })

  it('set_media_placement moves a picture, validates the index, clears the index when leaving in_key_details', async () => {
    const m = (await mediaOf()).find((x) => x.placement === 'in_key_details')!
    expect((await call(owner, 'set_media_placement', { media_id: m.media_id, placement: 'in_key_details', after_key_detail_index: 1 })).isError).toBe(false)
    expect((await mediaOf()).find((x) => x.media_id === m.media_id)!.after_key_detail_index).toBe(1)
    expect((await call(owner, 'set_media_placement', { media_id: m.media_id, placement: 'in_key_details', after_key_detail_index: 3 })).text).toMatch(/valid indexes 0–2/)
    expect((await call(owner, 'set_media_placement', { media_id: m.media_id, placement: 'in_key_details' })).text).toMatch(/needs after_key_detail_index/)
    expect((await call(owner, 'set_media_placement', { media_id: m.media_id, placement: 'before_lessons', after_key_detail_index: 1 })).text).toMatch(/only applies/)
    expect((await call(owner, 'set_media_placement', { media_id: m.media_id, placement: 'before_lessons' })).isError).toBe(false)
    expect((await mediaOf()).find((x) => x.media_id === m.media_id)).toMatchObject({ placement: 'before_lessons', after_key_detail_index: null })
    expect((await call(owner, 'set_media_placement', { media_id: m.media_id })).isError).toBe(true) // placement is required here
  })

  it('shrinking key_details under a placed picture warns on drafts and is refused on published events', async () => {
    await call(owner, 'set_media_placement', { media_id: (await mediaOf())[0]!.media_id, placement: 'in_key_details', after_key_detail_index: 2 })
    const r = await call(owner, 'update_event', { slug: 'ev-media', translation: { lang: 'bn', key_details: ['একটি'] } })
    expect(r.isError).toBe(false)
    expect(r.json.warnings[0]).toMatch(/would no longer exist/)
    expect((await call(owner, 'get_event', { slug: 'ev-media' })).json.publish_blockers.join()).toMatch(/does not exist.*set_media_placement/)
    await call(owner, 'update_event', { slug: 'ev-media', translation: { lang: 'bn', key_details: KD } }) // restore
  })

  it('published events: editors cannot move pictures, owners can (marked live), publishing is gated by placements', async () => {
    await call(owner, 'create_source', { slug: 'src-m', book: 'বই', author: 'লেখক' })
    await call(owner, 'add_source_citation', { event_slug: 'ev-media', source_slug: 'src-m', page: '2' })
    await call(owner, 'set_primary_place', { event_slug: 'ev-media', place_slug: 'zamzam' })
    expect((await call(owner, 'publish_event', { slug: 'ev-media' })).isError).toBe(false)
    const id = (await mediaOf())[0]!.media_id
    expect((await call(editor, 'set_media_placement', { media_id: id, placement: 'hero' })).text).toMatch(/editors can only modify drafts/)
    const r = await call(owner, 'set_media_placement', { media_id: id, placement: 'hero' })
    expect(r.isError).toBe(false)
    expect(r.json.live).toMatch(/already live/)
    expect((await call(owner, 'update_event', { slug: 'ev-media', translation: { lang: 'bn', key_details: ['একটি'] } })).text).toMatch(/Move them first/)
  })

  it('revert of an upload removes the picture and its file; revert of the draft creation removes everything', async () => {
    await mk('ev-clean', 'পরিষ্কার')
    const before = (await env.MEDIA.list()).objects.length
    const r = await up({ event_slug: 'ev-clean', placement: 'hero' })
    expect((await env.MEDIA.list()).objects.length).toBe(before + 1)
    expect((await mediaOf('ev-clean')).length).toBe(1)
    await up({ event_slug: 'ev-clean' })
    const revs = (await call(owner, 'list_revisions', { event_slug: 'ev-clean' })).json.revisions
    const first = revs.find((x: any) => x.action === 'upload_media' && true)
    expect(r.json.revision_id).toBeTruthy()
    // revert the creation: draft, both pictures and both files are gone
    const creation = revs.find((x: any) => x.action === 'create')
    expect((await call(owner, 'revert_revision', { revision_id: creation.revision_id })).isError).toBe(false)
    expect(await db().query.media.findMany({ where: eq(s.media.r2Key, r.json.r2_key) })).toEqual([])
    expect((await env.MEDIA.list()).objects.length).toBe(before)
    void first
  })

  it('reverting just the upload brings back the state before it, and deletes the file', async () => {
    await mk('ev-up', 'আপলোড রিভার্ট')
    const r = await up({ event_slug: 'ev-up' })
    const n = (await env.MEDIA.list()).objects.length
    expect((await call(owner, 'revert_revision', { revision_id: r.json.revision_id })).isError).toBe(false)
    expect((await mediaOf('ev-up')).length).toBe(0)
    expect((await env.MEDIA.list()).objects.length).toBe(n - 1)
  })

  it('the no-people rules are unchanged', async () => {
    expect((await up({ kind: 'portrait' })).isError).toBe(true)
    expect((await up({ kind: 'person' })).text).toMatch(/never allowed/)
    expect((await up({ contains_people_confirmation: true })).isError).toBe(true)
    expect((await up({ alt: {} })).isError).toBe(true)
  })
})

describe('imageSize', () => {
  it('reads PNG, JPEG, WebP (VP8X, VP8L, VP8) and AVIF headers; unknown → null', () => {
    expect(imageSize(png(640, 480))).toEqual({ width: 640, height: 480 })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
    expect(imageSize(jpeg)).toEqual({ width: 640, height: 480 })
    const riff = (fourcc: string, body: number[]) => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...[...fourcc].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...body])
    const vp8x = riff('VP8X', [0, 0, 0, 0, 0x7f, 0x02, 0, 0xdf, 0x01, 0, ...new Array(8).fill(0)])
    expect(imageSize(vp8x)).toEqual({ width: 640, height: 480 })
    const vp8l = riff('VP8L', [0x2f, 0x7f, 0x02 | 0, 0, 0, ...new Array(8).fill(0)]) // w-1 = 639 → 0x27f
    expect(imageSize(vp8l)?.width).toBe(1 + (((0x02 & 0x3f) << 8) | 0x7f))
    const vp8 = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01, ...new Array(8).fill(0)])
    expect(imageSize(vp8)).toEqual({ width: 640, height: 480 })
    const avif = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0, 0x69, 0x73, 0x70, 0x65, 0, 0, 0, 0, 0, 0, 2, 0x80, 0, 0, 1, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(imageSize(avif)).toEqual({ width: 640, height: 480 })
    expect(imageSize(new Uint8Array(40))).toBeNull()
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})
