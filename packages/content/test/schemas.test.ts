import { describe, it, expect } from 'vitest'
import {
  AyahRefSchema, HadithRefSchema, UploadMediaSchema, CreateRouteSchema, CreatePlaceSchema, CreateEventDraftSchema,
  RecallQuestionSchema, CitationSchema, publishBlockers, placementProblem, placeZoom, effectiveZoom, maxZoomAt, DEFAULT_ZOOM, PlaceTypeSchema, addHonorific, missingHonorific, HijriYearSchema, GAZETTEER_SEED, inArabiaBBox,
} from '../src'

const msgs = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message).join(' | ') ?? ''

describe('Qur\'an text is never accepted from the client', () => {
  it('accepts refs only', () => expect(AyahRefSchema.safeParse({ surah: 96, ayah: 1 }).success).toBe(true))
  it('rejects client-supplied arabic / translation text', () => {
    const r = AyahRefSchema.safeParse({ surah: 96, ayah: 1, arabic: 'ٱقْرَأْ', translation: 'পড়ো' })
    expect(r.success).toBe(false)
    expect(msgs(r)).toMatch(/never accepted/)
  })
  it('rejects out-of-range refs', () => {
    const r = AyahRefSchema.safeParse({ surah: 1, ayah: 9 })
    expect(msgs(r)).toMatch(/has 7 ayat/)
  })
})

describe('hadith', () => {
  it('stores reference + grading, rejects text', () => {
    expect(HadithRefSchema.safeParse({ collection: 'Sahih al-Bukhari', number: '3', grading: 'Sahih' }).success).toBe(true)
    expect(HadithRefSchema.safeParse({ collection: 'Sahih al-Bukhari', number: '3', grading: 'Sahih', text: 'invented' }).success).toBe(false)
    expect(HadithRefSchema.safeParse({ collection: 'Sahih al-Bukhari', number: '3' }).success).toBe(false)
  })
})

describe('no people imagery', () => {
  const base = { mime: 'image/png', alt: { bn: 'হেরা পর্বতের দৃশ্য' }, contains_people_confirmation: false, base64: 'AAAA' }
  it.each(['map', 'landscape', 'architecture', 'object', 'pattern', 'calligraphy'])('allows %s', (kind) =>
    expect(UploadMediaSchema.safeParse({ ...base, kind }).success).toBe(true))
  it.each(['portrait', 'person', 'illustration', 'photo', undefined])('rejects kind %s', (kind) => {
    const r = UploadMediaSchema.safeParse({ ...base, kind })
    expect(r.success).toBe(false)
    expect(msgs(r)).toMatch(/never allowed|Invalid/i)
  })
  it('rejects people confirmation, svg and oversize', () => {
    expect(UploadMediaSchema.safeParse({ ...base, kind: 'map', contains_people_confirmation: true }).success).toBe(false)
    expect(UploadMediaSchema.safeParse({ ...base, kind: 'map', mime: 'image/svg+xml' }).success).toBe(false)
    expect(UploadMediaSchema.safeParse({ ...base, kind: 'map', base64: 'A'.repeat(8_000_000) }).success).toBe(false)
  })
  it('requires alt text', () => expect(UploadMediaSchema.safeParse({ ...base, kind: 'map', alt: {} }).success).toBe(false))
})

describe('geo', () => {
  const route = (coordinates: number[][], allow = false) => CreateRouteSchema.safeParse({ slug: 'r', names: { bn: 'পথ' }, geojson: { type: 'LineString', coordinates }, allow_outside_arabia: allow })
  it('accepts a route inside the bbox', () => expect(route([[39.826, 21.42], [39.61, 24.47]]).success).toBe(true))
  it('rejects swapped lat/lng with a hint', () => {
    const r = route([[21.42, 39.826], [24.47, 39.61]])
    expect(r.success).toBe(false)
    expect(msgs(r)).toMatch(/\[lng, lat\]/)
  })
  it('allows outside when flagged', () => expect(route([[0, 0], [1, 1]], true).success).toBe(true))
  it('needs 2+ points', () => expect(route([[39.8, 21.4]]).success).toBe(false))
  it('place bbox check', () => {
    expect(CreatePlaceSchema.safeParse({ slug: 'p', type: 'city', lat: 21.4, lng: 39.8, names: { bn: 'মক্কা' } }).success).toBe(true)
    expect(CreatePlaceSchema.safeParse({ slug: 'p', type: 'city', lat: 51.5, lng: -0.1, names: { en: 'London' } }).success).toBe(false)
  })
  it('all gazetteer seeds lie in the bbox and have bn/en/ar names', () => {
    for (const p of GAZETTEER_SEED) {
      expect(inArabiaBBox(p.lng, p.lat), p.slug).toBe(true)
      expect(p.names.bn && p.names.en && p.names.ar).toBeTruthy()
    }
    for (const s of ['makkah', 'madinah', 'taif', 'hira', 'thawr', 'badr', 'uhud']) expect(GAZETTEER_SEED.some((p) => p.slug === s), s).toBe(true)
  })
})

describe('honorific', () => {
  it('adds ﷺ after the name, idempotently', () => {
    expect(addHonorific('মুহাম্মাদ হেরা গুহায় গেলেন')).toBe('মুহাম্মাদ ﷺ হেরা গুহায় গেলেন')
    expect(addHonorific(addHonorific('Prophet Muhammad went'))).toBe('Prophet Muhammad ﷺ went')
    expect(addHonorific('রাসূলুল্লাহ ﷺ বললেন')).toBe('রাসূলুল্লাহ ﷺ বললেন')
  })
  it('does not touch other people named Muhammad', () => {
    expect(addHonorific('Muhammad ibn Ishaq wrote')).toBe('Muhammad ibn Ishaq wrote')
  })
  it('never doubles ﷺ, in any existing form', () => {
    for (const t of ['Muhammad ﷺ', 'Muhammadﷺ', 'Muhammad  ﷺ', 'Muhammad (ﷺ)', 'Muhammad [ﷺ]', 'Prophet Muhammad ﷺ spoke', 'Messenger of Allah ﷺ', 'محمد ﷺ', 'মুহাম্মদ ﷺ', 'মুহাম্মদ (সা.)', 'রাসূলুল্লাহ ﷺ বললেন'])
      expect(addHonorific(t), t).toBe(t)
    const once = addHonorific('Muhammad was born. Later Muhammad migrated; Rasulullah and Muhammad ﷺ')
    expect(once.match(/ﷺ/g)).toHaveLength(4)
    expect(addHonorific(once)).toBe(once)
    const t = CreateEventDraftSchema.parse({ slug: 'x', era_slug: 'e', translation: { lang: 'bn', title: 'মুহাম্মদ ﷺ', summary: 'রাসূলুল্লাহ ﷺ এলেন' } })
    expect(t.translation.title).toBe('মুহাম্মদ ﷺ')
    expect(t.translation.summary).toBe('রাসূলুল্লাহ ﷺ এলেন')
  })
  it('never applies to other people named Muhammad', () => {
    for (const t of ['Muhammad ibn Maslamah went to Khaybar', 'Muhammad bin Maslamah', 'Muhammad ibn Ishaq wrote', 'Abdullah ibn Muhammad', 'Ali bin Muhammad', 'মুহাম্মদ ইবনে মাসলামা', 'মুহাম্মাদ ইবনে ইসহাক', 'মুহাম্মদ ইবন মাসলামা', 'আব্দুল্লাহ ইবনে মুহাম্মদ'])
      expect(addHonorific(t), t).toBe(t)
    expect(addHonorific('Muhammad ibn Maslamah met Muhammad')).toBe('Muhammad ibn Maslamah met Muhammad ﷺ')
  })
  it('handles Bangla inflection: ﷺ goes after the whole inflected word, never inside it', () => {
    expect(addHonorific('নবীজির জন্ম')).toBe('নবীজির ﷺ জন্ম')
    expect(addHonorific('নবীজিকে দেখলেন')).toBe('নবীজিকে ﷺ দেখলেন')
    expect(addHonorific('মুহাম্মাদের কথা')).toBe('মুহাম্মাদের ﷺ কথা')
    for (const t of ['নবীজির ﷺ জন্ম', 'নবীজিকে ﷺ দেখলেন', 'নবীজির (সা.) জন্ম', 'রাসূলুল্লাহর ﷺ নির্দেশ'])
      expect(addHonorific(t), t).toBe(t)
    expect(missingHonorific('নবীজির ﷺ জন্ম')).toBe(false)
    expect(missingHonorific('নবীজির জন্ম')).toBe(true)
    expect(addHonorific('মুহাম্মদ ইবনে মাসলামার কথা')).toBe('মুহাম্মদ ইবনে মাসলামার কথা')
  })
  it('detects missing', () => {
    expect(missingHonorific('Muhammad spoke')).toBe(true)
    expect(missingHonorific('Muhammad ﷺ spoke')).toBe(false)
    expect(missingHonorific('no names here')).toBe(false)
  })
  it('is applied by content schemas', () => {
    const r = CreateEventDraftSchema.parse({ slug: 'x', era_slug: 'e', translation: { lang: 'bn', title: 'মুহাম্মাদ এর জন্ম', summary: 'বিবরণ' } })
    expect(r.translation.title).toBe('মুহাম্মাদ ﷺ এর জন্ম')
  })
})

describe('events', () => {
  const t = { lang: 'bn', title: 'শিরোনাম', summary: 'সারসংক্ষেপ' }
  it('disputed needs a dispute note', () => {
    const r = CreateEventDraftSchema.safeParse({ slug: 'x', era_slug: 'e', certainty: 'disputed', translation: t })
    expect(msgs(r)).toMatch(/dispute_note/)
    expect(CreateEventDraftSchema.safeParse({ slug: 'x', era_slug: 'e', certainty: 'disputed', translation: { ...t, dispute_note: 'মতভেদ আছে' } }).success).toBe(true)
  })
  it('rejects bad slug', () => expect(CreateEventDraftSchema.safeParse({ slug: 'Bad Slug', era_slug: 'e', translation: t }).success).toBe(false))
  it('hijri year has no zero', () => {
    expect(HijriYearSchema.safeParse(0).success).toBe(false)
    expect(HijriYearSchema.safeParse(-13).success).toBe(true)
  })
  it('citation requires a page', () => expect(CitationSchema.safeParse({ event_slug: 'a', source_slug: 'b' }).success).toBe(false))
  it('recall question needs distinct options', () => {
    expect(RecallQuestionSchema.safeParse({ event_slug: 'a', lang: 'bn', question: 'প্রশ্ন', answer: 'ক', distractors: ['খ', 'ক'] }).success).toBe(false)
    expect(RecallQuestionSchema.safeParse({ event_slug: 'a', lang: 'bn', question: 'প্রশ্ন', answer: 'ক', distractors: ['খ', 'গ'] }).success).toBe(true)
  })
})

describe('publishBlockers', () => {
  const ok = { certainty: 'agreed' as const, sourceCount: 1, translations: [{ lang: 'bn', title: 't', summary: 's' }], primaryPlaceCount: 1 }
  it('passes a complete event', () => expect(publishBlockers(ok)).toEqual([]))
  it('requires a source', () => expect(publishBlockers({ ...ok, sourceCount: 0 })[0]).toMatch(/source citation/))
  it('requires certainty', () => expect(publishBlockers({ ...ok, certainty: null })[0]).toMatch(/Certainty/))
  it('requires default-lang translation', () => expect(publishBlockers({ ...ok, translations: [] })[0]).toMatch(/"bn" translation/))
  it('requires exactly one primary place', () => {
    expect(publishBlockers({ ...ok, primaryPlaceCount: 0 })[0]).toMatch(/No primary place/)
    expect(publishBlockers({ ...ok, primaryPlaceCount: 2 })[0]).toMatch(/2 primary places/)
  })
  it('blocks a picture whose key-detail index no longer exists', () => {
    const media = [{ id: 'm1', placement: 'in_key_details' as const, after_key_detail_index: 3 }]
    expect(publishBlockers({ ...ok, keyDetailCount: 2, media })[0]).toMatch(/does not exist.*valid indexes 0–1/)
    expect(publishBlockers({ ...ok, keyDetailCount: 4, media })).toEqual([])
  })
  it('disputed requires note', () => expect(publishBlockers({ ...ok, certainty: 'disputed' })[0]).toMatch(/dispute_note/))
})

describe('place types and zoom', () => {
  it('only region, city and site exist', () => {
    for (const t of ['region', 'city', 'site']) expect(PlaceTypeSchema.safeParse(t).success).toBe(true)
    for (const t of ['mountain', 'cave', 'battlefield', 'village']) expect(PlaceTypeSchema.safeParse(t).success, t).toBe(false)
  })
  it('default zoom by type: region 6, city 12, site 17', () => {
    expect(DEFAULT_ZOOM).toEqual({ region: 6, city: 12, site: 17 })
    expect(placeZoom('region')).toBe(6)
    expect(placeZoom('city', null)).toBe(12)
    expect(placeZoom('site', undefined)).toBe(17)
  })
  it('an override wins over the type default', () => {
    expect(placeZoom('site', 14)).toBe(14)
    expect(placeZoom('city', 9)).toBe(9)
  })
  it('zoom is capped where only coarse tiles exist, and not inside the detailed Makkah area', () => {
    expect(maxZoomAt(39.826, 21.4225)).toBe(17) // Kaaba: detail tiles (z15) + 2 over-zoom
    expect(maxZoomAt(39.61, 24.47)).toBe(12) // Madinah: base tiles only (z10) + 2
    expect(effectiveZoom('site', null, 39.826, 21.4225)).toBe(17)
    expect(effectiveZoom('site', null, 38.775, 23.73)).toBe(12) // Badr: asked 17, tiles allow 12
    expect(effectiveZoom('city', null, 39.61, 24.47)).toBe(12)
    expect(effectiveZoom('region', null, 40.6, 21)).toBe(6)
  })
  it('create_place validates zoom range and accepts a parent slug', () => {
    const base = { slug: 'zamzam', type: 'site', lat: 21.422, lng: 39.826, names: { en: 'Zamzam' } }
    expect(CreatePlaceSchema.safeParse({ ...base, parent_place_slug: 'makkah', zoom: 17 }).success).toBe(true)
    expect(CreatePlaceSchema.safeParse({ ...base, zoom: 25 }).success).toBe(false)
    expect(CreatePlaceSchema.safeParse({ ...base, zoom: 1 }).success).toBe(false)
    expect(CreatePlaceSchema.safeParse({ ...base, type: 'cave' }).success).toBe(false)
  })
  it('gazetteer: new types only, Makkah sites have a parent and are unverified', () => {
    for (const p of GAZETTEER_SEED) {
      expect(['region', 'city', 'site']).toContain(p.type)
      expect(p.verified).toBe(false)
      if (p.parent) expect(GAZETTEER_SEED.find((x) => x.slug === p.parent)?.type, p.slug).toBe('city')
    }
    for (const s of ['masjid-al-haram', 'zamzam']) {
      const g = GAZETTEER_SEED.find((p) => p.slug === s)!
      expect(g.type).toBe('site')
      expect(g.parent).toBe('makkah')
    }
  })
})

describe('media placement', () => {
  const up = { kind: 'landscape', mime: 'image/png', alt: { bn: 'পাহাড়ের দৃশ্য' }, contains_people_confirmation: false, base64: 'AAAA' }
  it('defaults to gallery', () => {
    const r = UploadMediaSchema.safeParse(up)
    expect(r.success && r.data.placement).toBe('gallery')
  })
  it('in_key_details needs an index; other placements reject one', () => {
    expect(msgs(UploadMediaSchema.safeParse({ ...up, placement: 'in_key_details' }))).toMatch(/needs after_key_detail_index/)
    expect(UploadMediaSchema.safeParse({ ...up, placement: 'in_key_details', after_key_detail_index: 0 }).success).toBe(true)
    expect(msgs(UploadMediaSchema.safeParse({ ...up, placement: 'hero', after_key_detail_index: 1 }))).toMatch(/only applies to placement "in_key_details"/)
  })
  it('unknown placements are rejected with the list of valid ones', () => {
    expect(msgs(UploadMediaSchema.safeParse({ ...up, placement: 'footer' }))).toMatch(/hero, after_summary, in_key_details, before_lessons, gallery/)
  })
  it('index must exist in the key details', () => {
    expect(placementProblem({ placement: 'in_key_details', after_key_detail_index: 2 }, 3)).toBeNull()
    expect(placementProblem({ placement: 'in_key_details', after_key_detail_index: 3 }, 3)).toMatch(/valid indexes 0–2/)
    expect(placementProblem({ placement: 'in_key_details', after_key_detail_index: 0 }, 0)).toMatch(/no key_details yet/)
    expect(placementProblem({ placement: 'gallery' }, 0)).toBeNull()
  })
  it('the no-people rules are unchanged', () => {
    expect(UploadMediaSchema.safeParse({ ...up, kind: 'portrait' }).success).toBe(false)
    expect(UploadMediaSchema.safeParse({ ...up, contains_people_confirmation: true }).success).toBe(false)
    expect(UploadMediaSchema.safeParse({ ...up, alt: {} }).success).toBe(false)
  })
})
