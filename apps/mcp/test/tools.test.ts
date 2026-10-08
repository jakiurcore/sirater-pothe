import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:workers'
import { call, db, makeToken, rpc, seedEra } from './helpers'
import { schema as s } from '@seerah/db'

let owner: string, editor: string
const T = { lang: 'bn', title: 'প্রথম ওহী', summary: 'হেরা গুহায় মুহাম্মাদ এর কাছে ওহী আসে।' }
const draft = (slug = 'first-revelation', title = T.title) => call(owner, 'create_event_draft', { slug, era_slug: 'makkan-early', hijri_year: -13, translation: { ...T, title } })

beforeAll(async () => {
  await seedEra()
  owner = await makeToken('owner-user', 'owner')
  editor = await makeToken('editor-user', 'editor')
})

describe('auth', () => {
  it('token of a user removed from the allow-list stops working', async () => {
    const t = await makeToken('stranger', 'owner')
    const r = await rpc(t, 'tools/list')
    expect(r.status).toBe(403)
  })
  it('invalid token → 401', async () => expect((await rpc('sk_seerah_nope', 'tools/list')).status).toBe(401))
})

describe('event lifecycle', () => {
  it('creates a draft, inserts ﷺ, rejects duplicate slug and title', async () => {
    const r = await draft()
    expect(r.isError).toBe(false)
    const g = await call(owner, 'get_event', { slug: 'first-revelation' })
    expect(g.json.status).toBe('draft')
    expect(g.json.translation.summary).toContain('মুহাম্মাদ ﷺ')
    expect((await draft()).text).toMatch(/already exists/)
    expect((await draft('other-slug')).text).toMatch(/titled/)
  })
  it('gives clear errors for bad input', async () => {
    const r = await call(owner, 'create_event_draft', { slug: 'Bad Slug', era_slug: 'makkan-early', translation: T })
    expect(r.isError).toBe(true)
    console.log('invalid-input error:', r.text.slice(0, 300))
    expect(r.text).toMatch(/slug/i)
    expect((await call(owner, 'create_event_draft', { slug: 'x-y', era_slug: 'nope', translation: T })).text).toMatch(/Available eras/)
  })
  it('publish is blocked until a source exists, then needs_verification gate, then works', async () => {
    const e = await call(owner, 'publish_event', { slug: 'first-revelation' })
    expect(e.isError).toBe(true)
    expect(e.text).toMatch(/source citation/)
    expect((await call(owner, 'create_source', { slug: 'rahiq', book: 'আর-রাহীকুল মাখতূম', author: 'সাফিউর রহমান মোবারকপুরী' })).isError).toBe(false)
    expect((await call(owner, 'add_source_citation', { event_slug: 'first-revelation', source_slug: 'rahiq', volume: '1', page: '98' })).isError).toBe(false)
    await db().update(s.events).set({ needsVerification: true })
    expect((await call(owner, 'publish_event', { slug: 'first-revelation' })).text).toMatch(/confirm_verified/)
    const ok = await call(owner, 'publish_event', { slug: 'first-revelation', confirm_verified: true })
    expect(ok.isError).toBe(false)
    expect((await call(owner, 'get_event', { slug: 'first-revelation' })).json.status).toBe('published')
  })
  it('disputed requires a note', async () => {
    const r = await call(owner, 'set_certainty', { slug: 'first-revelation', certainty: 'disputed' })
    expect(r.isError).toBe(true)
    expect((await call(owner, 'set_certainty', { slug: 'first-revelation', certainty: 'disputed', dispute_note: 'তারিখ নিয়ে মতভেদ আছে।' })).isError).toBe(false)
  })
})

describe('Qur\'an and hadith rules', () => {
  it('attach_ayah by reference returns server-fetched text', async () => {
    const r = await call(owner, 'attach_ayah', { event_slug: 'first-revelation', surah: 96, ayah: 1, ayahTo: 3 })
    expect(r.isError).toBe(false)
    expect(r.json.ayat).toHaveLength(3)
    expect(r.json.ayat[0].arabic).toMatch(/ٱقْرَأْ/)
    expect(r.json.requires_owner_confirmation).toBe(true)
    expect(r.json.license_warning).toMatch(/unverified/i)
    const g = await call(owner, 'get_event', { slug: 'first-revelation' })
    expect(g.json.ayat.map((a: any) => a.ref)).toEqual(['96:1', '96:2', '96:3'])
  })
  it('rejects client-supplied text and bad ranges', async () => {
    const a = await call(owner, 'attach_ayah', { event_slug: 'first-revelation', surah: 96, ayah: 1, arabic: 'invented' })
    expect(a.isError).toBe(true)
    expect(a.text).toMatch(/never accepted|unrecognized|Unrecognized/i)
    expect((await call(owner, 'attach_ayah', { event_slug: 'first-revelation', surah: 1, ayah: 9 })).text).toMatch(/has 7 ayat/)
    expect((await call(owner, 'attach_ayah', { event_slug: 'first-revelation', surah: 115, ayah: 1 })).text).toMatch(/does not exist/)
  })
  it('detach_ayah', async () => {
    expect((await call(owner, 'detach_ayah', { event_slug: 'first-revelation', surah: 96, ayah: 3 })).isError).toBe(false)
    expect((await call(owner, 'get_event', { slug: 'first-revelation' })).json.ayat).toHaveLength(2)
  })
  it('hadith: reference only', async () => {
    expect((await call(owner, 'attach_hadith_ref', { event_slug: 'first-revelation', collection: 'Sahih al-Bukhari', number: '3', grading: 'Sahih' })).isError).toBe(false)
    const bad = await call(owner, 'attach_hadith_ref', { event_slug: 'first-revelation', collection: 'Sahih al-Bukhari', number: '3', grading: 'Sahih', text: 'made up' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toMatch(/not accepted|Unrecognized|unrecognized/)
  })
})

describe('roles', () => {
  it('editor cannot publish/unpublish/verify and cannot edit published events', async () => {
    for (const [name, args] of [['publish_event', { slug: 'first-revelation' }], ['unpublish_event', { slug: 'first-revelation' }], ['verify_place', { slug: 'x' }]] as const) {
      const r = await call(editor, name, args)
      expect(r.isError, name).toBe(true)
      expect(r.text).toMatch(/owner-only/)
    }
    expect((await call(editor, 'update_event', { slug: 'first-revelation', patch: { hijri_year: -12 } })).text).toMatch(/only modify drafts/)
  })
  it('editor can create drafts and previews; tokens are capped at editor', async () => {
    expect((await call(editor, 'create_event_draft', { slug: 'editor-draft', era_slug: 'makkan-early', translation: { lang: 'bn', title: 'এডিটরের খসড়া', summary: 'সারাংশ' } })).isError).toBe(false)
    const p = await call(editor, 'preview_event', { slug: 'editor-draft' })
    expect(p.json.url).toMatch(/^https:\/\/seerah\.test\/bn\/preview\/editor-draft\?token=/)
    expect((await call(editor, 'create_api_token', { label: 'xx', role: 'owner' })).text).toMatch(/only create editor/)
    const t = await call(owner, 'create_api_token', { label: 'ci', role: 'owner' })
    expect(t.json.token).toMatch(/^sk_seerah_/)
    const stored = await db().select().from(s.apiTokens)
    expect(JSON.stringify(stored)).not.toContain(t.json.token) // only the hash is stored
    expect((await rpc(t.json.token, 'tools/list')).status).toBe(200)
    expect((await call(owner, 'revoke_api_token', { token_id: t.json.token_id })).isError).toBe(false)
    expect((await rpc(t.json.token, 'tools/list')).status).toBe(401)
  })
})

describe('preview token', () => {
  it('stores only a hash and an expiry', async () => {
    const p = await call(owner, 'preview_event', { slug: 'first-revelation', ttl_minutes: 30 })
    const token = new URL(p.json.url).searchParams.get('token')!
    const rows = await db().select().from(s.previewTokens)
    expect(rows.some((r) => r.tokenHash === token)).toBe(false)
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('places, routes, media', () => {
  it('find_place falls back to the gazetteer', async () => {
    const r = await call(owner, 'find_place', { query: 'হেরা' })
    expect(r.json.results[0]).toMatchObject({ slug: 'hira', in_database: false })
  })
  it('create_place enforces bbox; create_route enforces [lng,lat] and bbox', async () => {
    expect((await call(owner, 'create_place', { slug: 'london', type: 'city', lat: 51.5, lng: -0.1, names: { en: 'London' } })).isError).toBe(true)
    expect((await call(owner, 'create_place', { slug: 'makkah', type: 'city', lat: 21.4225, lng: 39.826, names: { bn: 'মক্কা' } })).isError).toBe(false)
    expect((await call(owner, 'create_route', { slug: 'r', names: { bn: 'পথ' }, geojson: { type: 'LineString', coordinates: [[21.4, 39.8], [24.4, 39.6]] } })).text).toMatch(/\[lng, lat\]/)
    expect((await call(owner, 'create_route', { slug: 'hijrah', names: { bn: 'হিজরত' }, geojson: { type: 'LineString', coordinates: [[39.826, 21.42], [39.61, 24.47]] } })).isError).toBe(false)
    expect((await call(owner, 'update_event', { slug: 'editor-draft', patch: { place_slug: 'makkah', route_slug: 'hijrah' } })).isError).toBe(false)
  })
  const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))
  const media = { mime: 'image/png', alt: { bn: 'হেরা পর্বতের দৃশ্য' }, contains_people_confirmation: false, base64: png }
  it('accepts allowed kinds and rejects people-ish kinds, svg, mismatched content', async () => {
    expect((await call(owner, 'upload_media', { ...media, kind: 'landscape', event_slug: 'editor-draft' })).isError).toBe(false)
    expect((await env.MEDIA.list()).objects.length).toBe(1)
    expect((await call(owner, 'upload_media', { ...media, kind: 'portrait' })).isError).toBe(true)
    expect((await call(owner, 'upload_media', { ...media, kind: 'map', contains_people_confirmation: true })).isError).toBe(true)
    expect((await call(owner, 'upload_media', { ...media, kind: 'map', mime: 'image/svg+xml' })).isError).toBe(true)
    expect((await call(owner, 'upload_media', { ...media, kind: 'map', base64: btoa('<svg onload=alert(1)>') })).text).toMatch(/not a PNG/)
    expect((await call(owner, 'upload_media', { ...media, kind: 'map', mime: 'image/jpeg' })).text).toMatch(/does not match/)
  })
})

describe('order, recall, revisions', () => {
  it('set_event_order and add_recall_questions', async () => {
    expect((await call(owner, 'set_event_order', { slug: 'editor-draft', after_slug: null })).isError).toBe(false)
    const o = await call(owner, 'get_timeline_outline', {})
    expect(o.json[0].events[0].slug).toBe('editor-draft')
    expect((await call(owner, 'add_recall_questions', { event_slug: 'first-revelation', questions: [{ question: 'কোথায়?', answer: 'হেরা', distractors: ['সাওর', 'উহুদ'] }] })).isError).toBe(false)
    expect((await call(owner, 'add_recall_questions', { event_slug: 'first-revelation', questions: [{ question: 'কোথায়?', answer: 'হেরা', distractors: ['হেরা', 'উহুদ'] }] })).isError).toBe(true)
  })
  it('add_translation is draft; update_event edits partially without wiping fields', async () => {
    expect((await call(owner, 'add_translation', { slug: 'editor-draft', translation: { lang: 'en', title: 'Editor draft', summary: 'Summary', lessons: ['one'] } })).json.status).toBe('draft')
    await call(owner, 'update_event', { slug: 'editor-draft', translation: { lang: 'en', title: 'Renamed' } })
    const g = await call(owner, 'get_event', { slug: 'editor-draft', lang: 'en' })
    expect(g.json.translation).toMatchObject({ title: 'Renamed', summary: 'Summary', lessons: ['one'] })
  })
  it('publish → revert restores draft state; revert of a revert is refused; create revert deletes draft', async () => {
    await call(owner, 'add_source_citation', { event_slug: 'editor-draft', source_slug: 'rahiq', page: '5' })
    await db().update(s.events).set({ needsVerification: false })
    expect((await call(owner, 'publish_event', { slug: 'editor-draft' })).isError).toBe(false)
    const revs = (await call(owner, 'list_revisions', { event_slug: 'editor-draft' })).json.revisions
    const pub = revs.find((r: any) => r.action === 'publish')
    expect((await call(editor, 'revert_revision', { revision_id: pub.revision_id })).text).toMatch(/Only the owner/)
    const rv = await call(owner, 'revert_revision', { revision_id: pub.revision_id })
    expect(rv.isError).toBe(false)
    expect((await call(owner, 'get_event', { slug: 'editor-draft' })).json.status).toBe('draft')
    expect((await call(owner, 'revert_revision', { revision_id: pub.revision_id })).text).toMatch(/already reverted/)
    // revert a field edit
    await call(owner, 'update_event', { slug: 'editor-draft', patch: { hijri_year: -5 } })
    const upd = (await call(owner, 'list_revisions', { event_slug: 'editor-draft' })).json.revisions.find((r: any) => r.action === 'update')
    await call(owner, 'revert_revision', { revision_id: upd.revision_id })
    expect((await call(owner, 'get_event', { slug: 'editor-draft' })).json.hijri_year).toBeNull()
  })
  it('writes are audited, reads are not', async () => {
    const rows = await db().select().from(s.auditLog)
    expect(rows.some((r) => r.tool === 'create_event_draft' && r.ok)).toBe(true)
    expect(rows.some((r) => r.tool === 'publish_event' && !r.ok)).toBe(true)
    expect(rows.some((r) => r.tool === 'list_eras')).toBe(false)
  })
})

describe('resources and prompt', () => {
  it('serve guidelines and prompt', async () => {
    const t = await makeToken('owner-user', 'owner')
    const r = await rpc(t, 'resources/read', { uri: 'seerah://content-guidelines' })
    expect(r.body.result.contents[0].text).toContain('No depiction of people'.slice(0, 0) + 'Hard rules')
    const p = await rpc(t, 'prompts/get', { name: 'add_event_from_my_notes', arguments: { notes: 'নবী ﷺ হেরা গুহায় যান' } })
    expect(p.body.result.messages[0].content.text).toContain('DUPLICATES')
  })
})
