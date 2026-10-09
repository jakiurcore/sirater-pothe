import { describe, it, expect, beforeAll } from 'vitest'
import { env, exports } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { schema as s } from '@seerah/db'
import { call, db, ensureUser, makeToken, seedEra } from './helpers'
import { b64, has, jpegBytes, pngBytes, sha256 } from './fixtures'

const worker = () => (exports as unknown as { default: { fetch: typeof fetch } }).default
let owner: string, editor: string
const KD = ['প্রথম বিবরণ', 'দ্বিতীয় বিবরণ', 'তৃতীয় বিবরণ']
const T = { lang: 'bn', title: 'আপলোড পরীক্ষা', summary: 'প্রথম অনুচ্ছেদ।\n\nদ্বিতীয় অনুচ্ছেদ।', key_details: KD, lessons: ['প্রথম শিক্ষা', 'দ্বিতীয় শিক্ষা'] }
const meta = (extra: object = {}) => ({ kind: 'landscape', alt: { bn: 'পাহাড়ের দৃশ্য' }, contains_people_confirmation: false, ...extra })
const tokenOf = (urlOrLink: string) => urlOrLink.split('/').at(-1)!
const put = (url: string, body: Uint8Array | string, headers: Record<string, string> = {}, ip = '9.9.0.1') =>
  worker().fetch(new Request(url, { method: 'PUT', body, headers: { 'CF-Connecting-IP': ip, ...headers } }))
const media = async (slug: string) => (await call(owner, 'get_event', { slug })).json.media as { media_id: string; placement: string; after_index: number | null; width: number; license: string | null }[]

beforeAll(async () => {
  await seedEra()
  owner = await makeToken('owner-user', 'owner')
  editor = await makeToken('editor-user', 'editor')
  for (const slug of ['up-ev', 'up-ev2', 'up-pub']) await call(owner, 'create_event_draft', { slug, era_slug: 'makkan-early', translation: { ...T, title: T.title + ' ' + slug } })
})

describe('create_upload_url: single-use signed PUT URL', () => {
  it('binds event, kind, placement, index and alt to the URL; one PUT stores the picture; the URL then dies', async () => {
    const c = await call(owner, 'create_upload_url', { event_slug: 'up-ev', ...meta({ placement: 'in_key_details', after_index: 1, caption: { bn: 'ক্যাপশন' } }) })
    expect(c.isError).toBe(false)
    expect(c.json.upload_url).toMatch(/^http:\/\/localhost:8787\/upload\/up_[A-Za-z0-9_-]{40,}$/)
    expect(c.json).toMatchObject({ method: 'PUT', single_use: true, bound_to: { event: 'up-ev', kind: 'landscape', placement: 'in_key_details', after_index: 1 } })
    expect(new Date(c.json.expires_at).getTime() - Date.now()).toBeGreaterThan(14 * 60_000)
    expect(new Date(c.json.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    const r = await put(c.json.upload_url, jpegBytes(1200, 800, { exif: true }), { 'Content-Type': 'application/x-www-form-urlencoded' }) // what curl --data-binary sends
    expect(r.status).toBe(200)
    const j = (await r.json()) as { ok: boolean; media_id: string; placement: string; after_index: number; metadata_removed: string[] }
    expect(j).toMatchObject({ ok: true, placement: 'in_key_details', after_index: 1 })
    expect(j.metadata_removed).toContain('EXIF')
    expect(await media('up-ev')).toMatchObject([{ placement: 'in_key_details', after_index: 1, width: 1200 }])
    const stored = new Uint8Array(await (await env.MEDIA.get((await db().query.media.findFirst({ where: eq(s.media.id, j.media_id) }))!.r2Key))!.arrayBuffer())
    expect(has(stored, 'SecretCam')).toBe(false)
    expect((await put(c.json.upload_url, pngBytes())).status).toBe(410) // single use
    expect((await media('up-ev')).length).toBe(1)
  })

  it('stores only a hash of the token, never the token', async () => {
    const c = await call(owner, 'create_upload_url', { event_slug: 'up-ev', ...meta() })
    const token = tokenOf(c.json.upload_url)
    const rows = await db().select().from(s.uploadTokens)
    expect(JSON.stringify(rows)).not.toContain(token)
    const h = await sha256(new TextEncoder().encode(token))
    expect(rows.some((r) => r.tokenHash === h)).toBe(true)
  })

  it('expires after 15 minutes', async () => {
    const c = await call(owner, 'create_upload_url', { event_slug: 'up-ev', ...meta() })
    await db().update(s.uploadTokens).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(s.uploadTokens.createdBy, 'owner-user'))
    const r = await put(c.json.upload_url, pngBytes())
    expect(r.status).toBe(410)
    expect(((await r.json()) as { error: string }).error).toMatch(/invalid, expired or already used/)
  })

  it('a bad file does not burn the token (up to 5 attempts); a good file then works', async () => {
    const c = await call(owner, 'create_upload_url', { event_slug: 'up-ev2', ...meta({ placement: 'hero' }) })
    const bad = await put(c.json.upload_url, '<svg onload=alert(1)></svg>')
    expect(bad.status).toBe(422)
    expect(((await bad.json()) as { error: string }).error).toMatch(/not a PNG, JPEG or WebP/)
    expect((await put(c.json.upload_url, pngBytes(8, 6), { 'Content-Type': 'image/jpeg' })).status).toBe(422) // declared jpeg, really png
    const ok = await put(c.json.upload_url, pngBytes(300, 200), { 'Content-Type': 'image/png' })
    expect(ok.status).toBe(200)
    expect((await media('up-ev2')).map((m) => m.placement)).toEqual(['hero'])
  })
  it('five failed attempts lock the token', async () => {
    const c = await call(owner, 'create_upload_url', { event_slug: 'up-ev2', ...meta() })
    for (let i = 0; i < 5; i++) expect((await put(c.json.upload_url, 'nope', {}, `9.9.1.${i}`)).status).toBe(422)
    expect((await put(c.json.upload_url, pngBytes(), {}, '9.9.1.9')).status).toBe(410)
  })

  it('the slot must exist when the URL is created, and the people rule still applies', async () => {
    const bad = await call(owner, 'create_upload_url', { event_slug: 'up-ev', ...meta({ placement: 'in_lessons', after_index: 5 }) })
    expect(bad.isError).toBe(true)
    expect(bad.text).toMatch(/lessons: the event has 2 lessons \(valid after_index 0–1\)/)
    expect((await call(owner, 'create_upload_url', { event_slug: 'up-ev', ...meta({ kind: 'portrait' }) })).isError).toBe(true)
    expect((await call(owner, 'create_upload_url', { event_slug: 'up-ev', ...meta({ contains_people_confirmation: true }) })).isError).toBe(true)
    expect((await call(owner, 'create_upload_url', { event_slug: 'nope', ...meta() })).isError).toBe(true)
  })

  it('if the text changes before the upload, the stored slot is checked again (the token stays usable)', async () => {
    await call(owner, 'create_event_draft', { slug: 'up-shrink', era_slug: 'makkan-early', translation: { ...T, title: 'সংকুচিত ঘটনা' } })
    const c = await call(owner, 'create_upload_url', { event_slug: 'up-shrink', ...meta({ placement: 'in_key_details', after_index: 2 }) })
    await call(owner, 'update_event', { slug: 'up-shrink', translation: { lang: 'bn', key_details: ['একটি'] } })
    const r = await put(c.json.upload_url, pngBytes())
    expect(r.status).toBe(422)
    expect(((await r.json()) as { error: string }).error).toMatch(/key_details: the event has 1 key detail/)
  })

  it('editors can bind uploads to drafts but not to published events; creating many links is rate limited', async () => {
    expect((await call(editor, 'create_upload_url', { event_slug: 'up-ev', ...meta() })).isError).toBe(false)
    await call(owner, 'create_source', { slug: 'up-src', book: 'বই', author: 'লেখক' })
    await call(owner, 'add_source_citation', { event_slug: 'up-pub', source_slug: 'up-src', page: '1' })
    await call(owner, 'create_place', { slug: 'up-place', type: 'city', lat: 21.4, lng: 39.8, names: { bn: 'স্থান' } })
    await call(owner, 'set_primary_place', { event_slug: 'up-pub', place_slug: 'up-place' })
    expect((await call(owner, 'publish_event', { slug: 'up-pub' })).isError).toBe(false)
    expect((await call(editor, 'create_upload_url', { event_slug: 'up-pub', ...meta() })).text).toMatch(/editors can only modify drafts/)
    expect((await call(owner, 'create_upload_url', { event_slug: 'up-pub', ...meta() })).isError).toBe(false)
    let last
    for (let i = 0; i < 25; i++) last = await call(editor, 'create_upload_url', { event_slug: 'up-ev', ...meta() })
    expect(last!.isError).toBe(true)
    expect(last!.text).toMatch(/Too many upload links/)
  })

  it('PUT is the only method; OPTIONS answers CORS for the site origin only; unknown paths are 404; oversize is refused', async () => {
    const c = await call(owner, 'create_upload_url', { event_slug: 'up-ev2', ...meta() })
    const url = c.json.upload_url as string
    expect((await worker().fetch(new Request(url, { method: 'GET' }))).status).toBe(405)
    const pre = await worker().fetch(new Request(url, { method: 'OPTIONS' }))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://seerah.test')
    expect(pre.headers.get('access-control-allow-methods')).toMatch(/PUT/)
    expect((await worker().fetch(new Request(`${env.MCP_ORIGIN}/upload/garbage`, { method: 'PUT', body: 'x' }))).status).toBe(404)
    const big = await put(url, new Uint8Array(10 * 1024 * 1024 + 1), { 'Content-Type': 'image/png' })
    expect(big.status).toBe(422)
    expect(((await big.json()) as { error: string }).error).toMatch(/limit/)
    const ok = await put(url, pngBytes())
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://seerah.test')
  })

  it('every attempt is in the audit log', async () => {
    const rows = await db().select().from(s.auditLog)
    const tools = rows.map((r) => r.tool)
    expect(tools).toEqual(expect.arrayContaining(['create_upload_url', 'upload.put']))
    expect(rows.some((r) => r.tool === 'upload.put' && r.ok === false)).toBe(true)
    expect(rows.some((r) => r.tool === 'upload.rejected')).toBe(true)
  })
})

describe('create_upload_link: the owner picks the file on the site', () => {
  it('returns a 30-minute single-use link to the site page; the page uploads with the "no people" confirmation', async () => {
    const c = await call(owner, 'create_upload_link', { event_slug: 'up-ev2', ...meta({ placement: 'in_summary', after_index: 0, alt: { bn: 'পরীক্ষার ছবি' } }) })
    expect(c.isError).toBe(false)
    expect(c.json.upload_link).toMatch(/^https:\/\/seerah\.test\/bn\/upload\/up_[A-Za-z0-9_-]{40,}$/)
    expect(new Date(c.json.expires_at).getTime() - Date.now()).toBeGreaterThan(29 * 60_000)
    const row = (await db().select().from(s.uploadTokens).where(eq(s.uploadTokens.mode, 'link')))[0]!
    expect(row).toMatchObject({ mode: 'link', kind: 'landscape', placement: 'in_summary', afterIndex: 0, createdBy: 'owner-user' })
    expect(row.alt).toEqual({ bn: 'পরীক্ষার ছবি' })
    const url = `${env.MCP_ORIGIN}/upload/${tokenOf(c.json.upload_link)}`
    const noConfirm = await put(url, pngBytes(500, 400), { 'Content-Type': 'image/png' })
    expect(noConfirm.status).toBe(400)
    expect(((await noConfirm.json()) as { error: string }).error).toMatch(/no people/)
    const ok = await put(url, pngBytes(500, 400), { 'Content-Type': 'image/png', 'X-People-Confirmed': 'no-people' })
    expect(ok.status).toBe(200)
    expect((await media('up-ev2')).find((m) => m.placement === 'in_summary')).toMatchObject({ after_index: 0 })
    expect((await put(url, pngBytes(), { 'X-People-Confirmed': 'no-people' })).status).toBe(410)
    expect((await db().select().from(s.auditLog)).some((r) => r.tool === 'upload.link' && r.ok)).toBe(true)
  })
  it('works for a language other than Bangla and refuses a slot that does not exist', async () => {
    const c = await call(owner, 'create_upload_link', { event_slug: 'up-ev2', lang: 'en', ...meta({ alt: { en: 'A picture' } }) })
    expect(c.json.upload_link).toMatch(/\/en\/upload\/up_/)
    expect((await call(owner, 'create_upload_link', { event_slug: 'up-ev2', ...meta({ placement: 'in_summary', after_index: 9 }) })).text).toMatch(/valid after_index 0–1/)
  })
  it('an account that was disabled after creating the link can no longer use it', async () => {
    await ensureUser('link-user', 'editor')
    const linker = await makeToken('link-user', 'editor')
    const c = await call(linker, 'create_upload_link', { event_slug: 'up-ev2', ...meta() })
    expect(c.isError).toBe(false)
    await db().update(s.users).set({ disabledAt: new Date().toISOString() }).where(eq(s.users.username, 'link-user'))
    const r = await put(`${env.MCP_ORIGIN}/upload/${tokenOf(c.json.upload_link)}`, pngBytes(), { 'X-People-Confirmed': 'no-people' })
    expect(r.status).toBe(403)
  })
})

describe('chunked upload: begin → chunk → finish', () => {
  const file = pngBytes(1200, 800, [], 70_000) // ~70 KB: three chunks of 32 KiB (the last one smaller)
  const chunks = [file.subarray(0, 32768), file.subarray(32768, 65536), file.subarray(65536)]
  const send = async (id: string, i: number, bytes: Uint8Array = chunks[i]!, hash?: string, tok = owner) => call(tok, 'upload_media_chunk', { upload_id: id, index: i, base64: b64(bytes), chunk_sha256: hash ?? (await sha256(bytes)) })
  const begin = async (over: object = {}) => call(owner, 'upload_media_begin', { event_slug: 'up-ev2', ...meta({ placement: 'in_key_details', after_index: 0 }), total_size: file.length, sha256: await sha256(file), ...over })

  it('splits into 32 KiB chunks, verifies every chunk and the whole file, and stores the picture where it was bound', async () => {
    const b = await begin()
    expect(b.isError).toBe(false)
    expect(b.json).toMatchObject({ chunk_size: 32768, chunk_count: 3 })
    const id = b.json.upload_id as string
    expect((await send(id, 0)).json).toMatchObject({ received: 1, of: 3, remaining: 2 })
    expect((await send(id, 2)).json).toMatchObject({ received: 2, remaining: 1 })
    const early = await call(owner, 'upload_media_finish', { upload_id: id })
    expect(early.isError).toBe(true)
    expect(early.text).toMatch(/Missing chunk: 1/)
    expect((await send(id, 1)).json.remaining).toBe(0)
    const before = (await media('up-ev2')).length
    const fin = await call(owner, 'upload_media_finish', { upload_id: id })
    expect(fin.isError).toBe(false)
    expect(fin.json).toMatchObject({ placement: 'in_key_details', after_index: 0, width: 1200 })
    expect((await media('up-ev2')).length).toBe(before + 1)
    expect((await env.MEDIA.list({ prefix: `tmp/${id}/` })).objects.length).toBe(0) // temporary chunks removed
    expect((await call(owner, 'upload_media_finish', { upload_id: id })).isError).toBe(true) // the session is gone
  })
  it('a chunk with a wrong hash is refused and the error names the chunk to send again', async () => {
    const id = (await begin()).json.upload_id as string
    const bad = await send(id, 1, chunks[1]!, 'a'.repeat(64))
    expect(bad.isError).toBe(true)
    expect(bad.text).toMatch(/Chunk 1 hash mismatch.*Send chunk 1 again/)
    expect((await env.MEDIA.list({ prefix: `tmp/${id}/` })).objects.length).toBe(0) // nothing stored
    const damaged = chunks[1]!.slice(); damaged[100]! ^= 0xff
    expect((await send(id, 1, damaged, await sha256(chunks[1]!))).text).toMatch(/Chunk 1 hash mismatch/)
    expect((await send(id, 1)).isError).toBe(false) // resending the right one works
    expect((await send(id, 1)).isError).toBe(false) // and sending twice is harmless
  })
  it('wrong chunk size, out-of-range index and bad base64 are refused', async () => {
    const id = (await begin()).json.upload_id as string
    expect((await send(id, 0, chunks[0]!.subarray(0, 100))).text).toMatch(/Chunk 0 must be 32768 bytes but is 100/)
    expect((await send(id, 5, chunks[0]!)).text).toMatch(/out of range.*3 chunks/)
    expect((await call(owner, 'upload_media_chunk', { upload_id: id, index: 0, base64: '***', chunk_sha256: 'a'.repeat(64) })).text).toMatch(/not valid base64/)
  })
  it('the final hash is checked: if the whole file differs, finish refuses and stores nothing', async () => {
    const other = pngBytes(1200, 800, [], 70_001)
    const id = (await begin({ total_size: other.length, sha256: await sha256(other) })).json.upload_id as string
    const part = [other.subarray(0, 32768), other.subarray(32768, 65536), other.subarray(65536)]
    const tampered = part[2]!.slice(); tampered[tampered.length - 20]! ^= 1 // each chunk's own hash matches what is sent, but the file is not the one announced
    for (let i = 0; i < 3; i++) { const b = i === 2 ? tampered : part[i]!; expect((await send(id, i, b)).isError).toBe(false) }
    const before = (await media('up-ev2')).length
    const fin = await call(owner, 'upload_media_finish', { upload_id: id })
    expect(fin.isError).toBe(true)
    expect(fin.text).toMatch(/does not match the SHA-256/)
    expect((await media('up-ev2')).length).toBe(before)
  })
  it('sessions belong to the user who started them, expire after an hour, and begin validates the slot and the size', async () => {
    const id = (await begin()).json.upload_id as string
    expect((await send(id, 0, chunks[0]!, undefined, editor)).text).toMatch(/No such upload session/)
    await db().update(s.uploadSessions).set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    expect((await send(id, 0)).text).toMatch(/expired/)
    expect((await begin({ placement: 'in_lessons', after_index: 7 })).text).toMatch(/valid after_index 0–1/)
    expect((await begin({ total_size: 11 * 1024 * 1024 })).isError).toBe(true)
    expect((await begin({ sha256: 'xyz' })).isError).toBe(true)
  })
})
