import { describe, it, expect } from 'vitest'
import {
  AyahRefSchema, HadithRefSchema, UploadMediaSchema, CreateRouteSchema, CreatePlaceSchema, CreateEventDraftSchema,
  RecallQuestionSchema, CitationSchema, publishBlockers, placementProblem, placementNeedsReview, summaryParagraphs, slotCounts, slotSort, PLACEMENTS, ALLOWED_MEDIA_MIME, MAX_MEDIA_BYTES, placeZoom, effectiveZoom, maxZoomAt, DEFAULT_ZOOM, PlaceTypeSchema, addHonorific, missingHonorific, HijriYearSchema, GAZETTEER_SEED, inArabiaBBox,
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
    expect(UploadMediaSchema.safeParse({ ...base, kind: 'map', base64: 'A'.repeat(14_000_000) }).success).toBe(false)
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

describe('shared placement model (pictures and ayat)', () => {
  const up = { kind: 'landscape', alt: { bn: 'পাহাড়ের দৃশ্য' }, contains_people_confirmation: false, base64: 'AAAA' }
  const counts = { summary: 3, keyDetails: 4, lessons: 2 }
  it('has the eight placements; gallery is for pictures only', () => {
    expect([...PLACEMENTS]).toEqual(['hero', 'in_summary', 'after_summary', 'in_key_details', 'in_lessons', 'before_lessons', 'end', 'gallery'])
    expect(placementProblem({ placement: 'gallery' }, 'media')).toBeNull()
    expect(placementProblem({ placement: 'gallery' }, 'ayah')).toMatch(/pictures only/)
  })
  it('pictures default to gallery', () => {
    const r = UploadMediaSchema.safeParse(up)
    expect(r.success && r.data.placement).toBe('gallery')
  })
  it('in_summary, in_key_details and in_lessons need after_index; other placements reject one', () => {
    for (const p of ['in_summary', 'in_key_details', 'in_lessons']) {
      expect(placementProblem({ placement: p as never }, 'media')).toMatch(/needs after_index/)
      expect(placementProblem({ placement: p as never, after_index: 0 }, 'media')).toBeNull()
    }
    for (const p of ['hero', 'after_summary', 'before_lessons', 'end', 'gallery']) expect(placementProblem({ placement: p as never, after_index: 1 }, 'media'), p).toMatch(/only applies to in_summary, in_key_details and in_lessons/)
    expect(msgs(UploadMediaSchema.safeParse({ ...up, placement: 'in_key_details' }))).toMatch(/needs after_index/)
    expect(UploadMediaSchema.safeParse({ ...up, placement: 'in_lessons', after_index: 0 }).success).toBe(true)
  })
  it('unknown placements are rejected with the list of valid ones', () => {
    expect(msgs(UploadMediaSchema.safeParse({ ...up, placement: 'footer' }))).toMatch(/hero, in_summary, after_summary, in_key_details, in_lessons, before_lessons, end, gallery/)
  })
  it('the index must exist in the text of that section, and the message gives the valid range', () => {
    expect(placementProblem({ placement: 'in_summary', after_index: 2 }, 'ayah', counts)).toBeNull()
    expect(placementProblem({ placement: 'in_summary', after_index: 3 }, 'ayah', counts)).toMatch(/summary: the event has 3 summary paragraphs \(valid after_index 0–2\)/)
    expect(placementProblem({ placement: 'in_key_details', after_index: 4 }, 'media', counts)).toMatch(/key_details: the event has 4 key details \(valid after_index 0–3\)/)
    expect(placementProblem({ placement: 'in_lessons', after_index: 2 }, 'media', counts)).toMatch(/lessons: the event has 2 lessons \(valid after_index 0–1\)/)
    expect(placementProblem({ placement: 'in_lessons', after_index: 0 }, 'media', { ...counts, lessons: 0 })).toMatch(/no lessons yet/)
    expect(placementProblem({ placement: 'in_key_details', after_index: -1 }, 'media', counts)).toMatch(/whole number/)
  })
  it('an index that stopped existing is flagged for review (not an error)', () => {
    expect(placementNeedsReview({ placement: 'in_key_details', after_index: 3 }, counts)).toBeNull()
    expect(placementNeedsReview({ placement: 'in_key_details', after_index: 4 }, counts)).toEqual({ section: 'key_details', count: 4, after_index: 4 })
    expect(placementNeedsReview({ placement: 'in_summary', after_index: 5 }, { ...counts, summary: 1 })).toEqual({ section: 'summary', count: 1, after_index: 5 })
    expect(placementNeedsReview({ placement: 'hero', after_index: null }, counts)).toBeNull()
  })
  it('summaries are paragraphs split on blank lines, backward compatible with a single string', () => {
    expect(summaryParagraphs('one line only')).toEqual(['one line only'])
    expect(summaryParagraphs('A\n\nB\r\n\r\n  \nC\nstill C')).toEqual(['A', 'B', 'C\nstill C'])
    expect(summaryParagraphs('')).toEqual([])
    expect(slotCounts({ summary: 'A\n\nB', keyDetails: ['x'], lessons: [] })).toEqual({ summary: 2, keyDetails: 1, lessons: 0 })
  })
  it('ayat and pictures sort together by order; at equal order pictures come first', () => {
    const items = [{ id: 'a1', kind: 'ayah' as const, order: 1 }, { id: 'm1', kind: 'media' as const, order: 1 }, { id: 'a0', kind: 'ayah' as const, order: 0 }, { id: 'm2', kind: 'media' as const, order: 2 }]
    expect(items.sort(slotSort).map((i) => i.id)).toEqual(['a0', 'm1', 'a1', 'm2'])
  })
  it('only png / jpeg / webp, up to 10 MB', () => {
    expect([...ALLOWED_MEDIA_MIME]).toEqual(['image/png', 'image/jpeg', 'image/webp'])
    expect(MAX_MEDIA_BYTES).toBe(10 * 1024 * 1024)
    expect(UploadMediaSchema.safeParse({ ...up, mime: 'image/avif' }).success).toBe(false)
    expect(UploadMediaSchema.safeParse({ ...up, mime: 'image/svg+xml' }).success).toBe(false)
  })
  it('the no-people rules are unchanged', () => {
    expect(UploadMediaSchema.safeParse({ ...up, kind: 'portrait' }).success).toBe(false)
    expect(UploadMediaSchema.safeParse({ ...up, contains_people_confirmation: true }).success).toBe(false)
    expect(UploadMediaSchema.safeParse({ ...up, alt: {} }).success).toBe(false)
  })
})
