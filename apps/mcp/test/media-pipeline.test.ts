import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:workers'
import { getDb } from '@seerah/db'
import { exifOrientation, hasMetadata, stripJpeg, stripMetadata, stripPng, stripWebp } from '../src/media/strip'
import { ALLOWED_HOSTS, commonsFile, evaluateLicense, importFromWikimedia, plainText, safeDownload, wikimediaTitle } from '../src/media/wikimedia'
import { ingestImage, imageSize, sniffMime } from '../src/media/ingest'
import type { ImageProcessor } from '../src/media/process'
import { b64, has, jpegBytes, pngBytes, webpBytes } from './fixtures'
import { call, makeToken, seedEra, db } from './helpers'

describe('metadata stripping (EXIF / GPS / XMP / IPTC / comments)', () => {
  it('JPEG: removes EXIF, XMP, IPTC and comments; keeps JFIF, the frame header and the entropy-coded data', () => {
    const src = jpegBytes(40, 30, { exif: true, xmp: true, comment: 'taken by SecretPerson' })
    for (const secret of ['GPSLatitudeRef', 'SecretCam', 'SecretXmp', 'IPTC-Caption-Secret', 'SecretPerson']) expect(has(src, secret), `fixture has ${secret}`).toBe(true)
    const out = stripJpeg(src)
    for (const secret of ['GPSLatitudeRef', 'SecretCam', 'SecretXmp', 'IPTC-Caption-Secret', 'SecretPerson', 'Exif']) expect(has(out.bytes, secret), `${secret} removed`).toBe(false)
    expect(out.removed).toEqual(expect.arrayContaining(['EXIF', 'XMP/APP1', 'IPTC/Photoshop', 'comment']))
    expect(has(out.bytes, 'JFIF')).toBe(true)
    expect(imageSize(out.bytes)).toEqual({ width: 40, height: 30 }) // still a readable JPEG
    expect([...out.bytes.slice(0, 2)]).toEqual([0xff, 0xd8])
    expect([...out.bytes.slice(-2)]).toEqual([0xff, 0xd9])
    expect(out.bytes.length).toBeLessThan(src.length)
    expect(hasMetadata(out.bytes, 'image/jpeg')).toBe(false)
    expect(hasMetadata(src, 'image/jpeg')).toBe(true)
  })
  it('JPEG without metadata comes out byte-identical', () => {
    const clean = stripJpeg(jpegBytes(10, 10)).bytes
    expect(stripJpeg(clean).bytes).toEqual(clean)
  })
  it('reads the EXIF orientation before removing it', () => {
    expect(stripJpeg(jpegBytes(40, 30, { exif: true, orientation: 6 })).orientation).toBe(6)
    expect(stripJpeg(jpegBytes(40, 30, { exif: true })).orientation).toBe(1)
    expect(stripJpeg(jpegBytes(40, 30)).orientation).toBe(1)
    expect(exifOrientation(new Uint8Array(3))).toBe(1)
  })
  it('PNG: removes text, EXIF and time chunks, keeps the critical and colour chunks', () => {
    const src = pngBytes(8, 6, [{ type: 'tEXt', data: [...'Author\0SecretPerson'].map((c) => c.charCodeAt(0)) }, { type: 'eXIf', data: [1, 2, 3] }, { type: 'tIME', data: [7, 0, 1, 1, 1, 1, 1] }, { type: 'gAMA', data: [0, 0, 0, 1] }])
    expect(has(src, 'SecretPerson')).toBe(true)
    const out = stripPng(src)
    expect(has(out.bytes, 'SecretPerson')).toBe(false)
    expect(out.removed).toEqual(expect.arrayContaining(['tEXt', 'EXIF', 'tIME']))
    expect(has(out.bytes, 'gAMA')).toBe(true)
    expect(has(out.bytes, 'IEND')).toBe(true)
    expect(imageSize(out.bytes)).toEqual({ width: 8, height: 6 })
    expect(hasMetadata(out.bytes, 'image/png')).toBe(false)
  })
  it('WebP: removes EXIF and XMP chunks, fixes the RIFF size and clears the VP8X flags', () => {
    const src = webpBytes(64, 48, { exif: true, xmp: true })
    expect(has(src, 'SecretXmp')).toBe(true)
    const out = stripWebp(src)
    expect(has(out.bytes, 'SecretXmp')).toBe(false)
    expect(has(out.bytes, 'EXIF')).toBe(false)
    expect(out.removed).toEqual(expect.arrayContaining(['EXIF', 'XMP']))
    expect(new DataView(out.bytes.buffer, out.bytes.byteOffset).getUint32(4, true)).toBe(out.bytes.length - 8)
    const vp8x = [...out.bytes].findIndex((_, i) => has(out.bytes.subarray(i, i + 4), 'VP8X'))
    expect(out.bytes[vp8x + 8]! & 0x0c).toBe(0)
    expect(imageSize(out.bytes)).toEqual({ width: 64, height: 48 })
  })
  it('corrupt files are refused, not half-processed', () => {
    expect(() => stripJpeg(new Uint8Array([0xff, 0xd8, 0x00, 0x01]))).toThrow(/corrupt/)
    expect(() => stripPng(pngBytes().slice(0, 30))).toThrow()
    expect(() => stripMetadata(new Uint8Array(8), 'image/gif')).toThrow(/cannot strip/)
  })
})

describe('magic bytes decide the type', () => {
  it('PNG / JPEG / WebP are recognised; SVG, GIF, AVIF, HTML and empty are not', () => {
    expect(sniffMime(pngBytes())).toBe('image/png')
    expect(sniffMime(jpegBytes())).toBe('image/jpeg')
    expect(sniffMime(webpBytes())).toBe('image/webp')
    for (const bad of ['<svg onload=alert(1)>', 'GIF89a....', '<!doctype html>', '']) expect(sniffMime(new TextEncoder().encode(bad)), bad).toBeNull()
    expect(sniffMime(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]))).toBeNull() // AVIF
  })
  it('a file named .png that is really SVG/HTML is rejected through the tool', async () => {
    await seedEra()
    const token = await makeToken('owner-user', 'owner')
    const text = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')
    const r = await call(token, 'upload_media', { kind: 'pattern', alt: { bn: 'পরীক্ষা নকশা' }, contains_people_confirmation: false, base64: b64(text), mime: 'image/png' })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/not a PNG, JPEG or WebP/)
    const gif = await call(token, 'upload_media', { kind: 'pattern', alt: { bn: 'পরীক্ষা নকশা' }, contains_people_confirmation: false, base64: btoa('GIF89a\x01\x00\x01\x00') })
    expect(gif.isError).toBe(true)
  })
})

describe('ingest: strips metadata, makes responsive copies, enforces limits', () => {
  const fakeProcessor = (calls: number[] = []): ImageProcessor => ({
    async resize(_b, w) { calls.push(w); return new Uint8Array([0x52, 0x49, 0x46, 0x46, w & 255]) },
    async bakeOrientation() { return null },
  })
  const meta = { kind: 'landscape', alt: { bn: 'পাহাড়ের দৃশ্য' }, placement: 'gallery' as const }
  const actor = { login: 'owner-user', role: 'owner' as const }

  it('stores the stripped original (no GPS / camera text) and records the hash', async () => {
    await seedEra()
    const src = jpegBytes(1000, 700, { exif: true, xmp: true, comment: 'SecretPerson' })
    const out = await ingestImage(env, getDb(env.DB), { bytes: src, meta, eventId: null, actor, via: 'test' }, fakeProcessor())
    const stored = new Uint8Array(await (await env.MEDIA.get(out.r2_key))!.arrayBuffer())
    for (const secret of ['GPSLatitudeRef', 'SecretCam', 'SecretXmp', 'IPTC-Caption-Secret', 'SecretPerson', 'Exif']) expect(has(stored, secret), secret).toBe(false)
    expect(out.metadata_removed).toEqual(expect.arrayContaining(['EXIF', 'XMP/APP1', 'IPTC/Photoshop', 'comment']))
    const row = await db().query.media.findFirst({ where: (m, { eq }) => eq(m.id, out.media_id) })
    expect(row!.sha256).toBe(out.sha256)
    expect(row!.width).toBe(1000)
  })
  it('makes 480 and 960 px webp copies for a 1200 px image (never enlarges, so no 1600)', async () => {
    const calls: number[] = []
    const out = await ingestImage(env, getDb(env.DB), { bytes: pngBytes(1200, 800), meta, eventId: null, actor, via: 'test' }, fakeProcessor(calls))
    expect(calls).toEqual([480, 960])
    expect(out.variants).toEqual([480, 960])
    for (const w of [480, 960]) expect(await env.MEDIA.head(`media/${out.media_id}-${w}.webp`)).toBeTruthy()
    expect(await env.MEDIA.head(`media/${out.media_id}-1600.webp`)).toBeNull()
    const row = await db().query.media.findFirst({ where: (m, { eq }) => eq(m.id, out.media_id) })
    expect(row!.variants).toEqual({ '480': `media/${out.media_id}-480.webp`, '960': `media/${out.media_id}-960.webp` })
  })
  it('a small image gets no copies; without a processor only the original is stored (nothing breaks)', async () => {
    const calls: number[] = []
    const small = await ingestImage(env, getDb(env.DB), { bytes: pngBytes(300, 200), meta, eventId: null, actor, via: 'test' }, fakeProcessor(calls))
    expect(calls).toEqual([])
    expect(small.variants).toEqual([])
    const none = await ingestImage(env, getDb(env.DB), { bytes: pngBytes(1200, 800), meta, eventId: null, actor, via: 'test' }, null)
    expect(none.variants).toEqual([])
    expect(none.processing).toMatch(/original only/)
  })
  it('rotated photos (EXIF orientation ≠ 1) are refused when the rotation cannot be baked in', async () => {
    await expect(ingestImage(env, getDb(env.DB), { bytes: jpegBytes(40, 30, { exif: true, orientation: 6 }), meta, eventId: null, actor, via: 'test' }, fakeProcessor())).rejects.toThrow(/stored rotated.*Rotate it upright/)
  })
  it('limits: empty, over 10 MB, wrong declared type, unreadable header', async () => {
    const go = (bytes: Uint8Array, declaredMime?: string) => ingestImage(env, getDb(env.DB), { bytes, declaredMime, meta, eventId: null, actor, via: 'test' }, null)
    await expect(go(new Uint8Array())).rejects.toThrow(/empty/)
    await expect(go(pngBytes(8, 6, [], 10 * 1024 * 1024 + 10))).rejects.toThrow(/10 MB/)
    await expect(go(pngBytes(), 'image/jpeg')).rejects.toThrow(/does not match/)
    await expect(go(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).rejects.toThrow(/unreadable|corrupt/)
    expect((await go(pngBytes(8, 6, [], 9 * 1024 * 1024))).bytes).toBeGreaterThan(9 * 1024 * 1024) // just under the limit is fine
  })
})

describe('Wikimedia Commons: URLs, licences, download rules', () => {
  const info = (over: Record<string, unknown> = {}, meta: Record<string, string> = {}) => ({
    query: { pages: [{ title: 'File:Jabal Nur.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Jabal_Nur.jpg', thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Jabal_Nur.jpg/1600px-Jabal_Nur.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Jabal_Nur.jpg', mime: 'image/jpeg', size: 900000, width: 3000, height: 2000, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ali">Ali &amp; Co</a>' }, Copyrighted: { value: 'True' }, ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { value: v }])) }, ...over }] }] },
  })
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

  it('titles from commons pages, upload URLs and thumbnails; other hosts and other wikis refused', () => {
    expect(wikimediaTitle('https://commons.wikimedia.org/wiki/File:Jabal_Nur.jpg')).toBe('File:Jabal Nur.jpg')
    expect(wikimediaTitle('https://upload.wikimedia.org/wikipedia/commons/a/ab/Jabal_Nur.jpg')).toBe('File:Jabal Nur.jpg')
    expect(wikimediaTitle('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Jabal_Nur.jpg/800px-Jabal_Nur.jpg')).toBe('File:Jabal Nur.jpg')
    expect(wikimediaTitle('https://commons.wikimedia.org/wiki/File:Caf%C3%A9.png')).toBe('File:Café.png')
    expect(() => wikimediaTitle('https://example.com/a.jpg')).toThrow(new RegExp(`not allowed.*${ALLOWED_HOSTS[0]}`))
    expect(() => wikimediaTitle('http://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg')).toThrow(/https/)
    expect(() => wikimediaTitle('https://upload.wikimedia.org/wikipedia/en/a/ab/x.jpg')).toThrow(/COMMONS/)
    expect(() => wikimediaTitle('https://commons.wikimedia.org/wiki/Category:Mecca')).toThrow(/file page/)
    expect(() => wikimediaTitle('not a url')).toThrow(/valid URL/)
  })
  it('accepts CC0, public domain, CC BY and CC BY-SA (any version); rejects NC, ND, GFDL, fair use, unknown, missing', () => {
    for (const ok of ['CC0', 'CC0 1.0', 'Public domain', 'PD-old-100', 'PD-US', 'CC BY 4.0', 'CC BY 2.0', 'CC BY-SA 4.0', 'CC BY-SA 3.0', 'CC BY-SA 2.5', 'CC-BY-SA-4.0', 'CC BY-SA 3.0 de']) expect(evaluateLicense(ok).ok, ok).toBe(true)
    for (const bad of ['CC BY-NC 4.0', 'CC BY-NC-SA 3.0', 'CC BY-ND 4.0', 'CC BY-NC-ND 2.0', 'GFDL', 'Fair use', 'All rights reserved', 'Attribution', 'Copyrighted free use', 'GPL']) expect(evaluateLicense(bad).ok, bad).toBe(false)
    expect(evaluateLicense(undefined).ok).toBe(false)
    expect(evaluateLicense(undefined, 'False')).toEqual({ ok: true, license: 'Public domain' })
  })
  it('a free file: licence, author (plain text) and credit line come from the API', async () => {
    const f = await commonsFile('File:Jabal Nur.jpg', (async () => json(info())) as typeof fetch)
    expect(f).toMatchObject({ license: 'CC BY-SA 4.0', author: 'Ali & Co', credit: 'Ali & Co, CC BY-SA 4.0, via Wikimedia Commons', mime: 'image/jpeg', descriptionUrl: 'https://commons.wikimedia.org/wiki/File:Jabal_Nur.jpg' })
    expect(plainText('<b>x</b>&nbsp;&lt;y&gt;')).toBe('x <y>')
  })
  it('a non-free licence is rejected with the reason; so are missing files, SVG, and API errors', async () => {
    await expect(commonsFile('File:x.jpg', (async () => json(info({}, { LicenseShortName: 'CC BY-NC 4.0' }))) as typeof fetch)).rejects.toThrow(/Refused:.*restricts commercial use/)
    await expect(commonsFile('File:x.jpg', (async () => json(info({}, { LicenseShortName: 'Fair use' }))) as typeof fetch)).rejects.toThrow(/Refused/)
    await expect(commonsFile('File:x.svg', (async () => json(info({ mime: 'image/svg+xml' }))) as typeof fetch)).rejects.toThrow(/only PNG, JPEG and WebP/)
    await expect(commonsFile('File:nope.jpg', (async () => json({ query: { pages: [{ title: 'File:nope.jpg', missing: true }] } })) as typeof fetch)).rejects.toThrow(/does not exist/)
    await expect(commonsFile('File:x.jpg', (async () => json({}, 503)) as typeof fetch)).rejects.toThrow(/503/)
    await expect(commonsFile('File:x.jpg', (async () => { throw new Error('net') }) as typeof fetch)).rejects.toThrow(/could not be reached/)
  })
  it('download: allow-listed hosts only (also after redirects), manual redirects, 10 MB cap', async () => {
    const ok = pngBytes(8, 6)
    expect(await safeDownload('https://upload.wikimedia.org/a.png', (async () => new Response(ok)) as typeof fetch)).toEqual(ok)
    await expect(safeDownload('https://evil.example/a.png', (async () => new Response(ok)) as typeof fetch)).rejects.toThrow(/Refusing/)
    const redirect = (async (u: string) => (u.includes('upload.wikimedia.org') ? new Response(null, { status: 302, headers: { Location: 'https://evil.example/x.png' } }) : new Response(ok))) as unknown as typeof fetch
    await expect(safeDownload('https://upload.wikimedia.org/a.png', redirect)).rejects.toThrow(/Refusing/)
    const hop = (async (u: string) => (u.endsWith('/a.png') ? new Response(null, { status: 301, headers: { Location: '/b.png' } }) : new Response(ok))) as unknown as typeof fetch
    expect(await safeDownload('https://upload.wikimedia.org/a.png', hop)).toEqual(ok)
    await expect(safeDownload('https://upload.wikimedia.org/a.png', (async () => new Response(ok, { headers: { 'Content-Length': String(11 * 1024 * 1024) } })) as typeof fetch)).rejects.toThrow(/limit/)
    const big = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)) } })
    await expect(safeDownload('https://upload.wikimedia.org/a.png', (async () => new Response(big)) as typeof fetch)).rejects.toThrow(/larger than/)
  })
  it('end to end with fakes: a free file downloads (the thumbnail when the original is too big); a non-free one never downloads', async () => {
    const urls: string[] = []
    const fake = (async (u: string) => { urls.push(u); return u.startsWith('https://commons.wikimedia.org/w/api.php') ? json(info({ size: 25 * 1024 * 1024 })) : new Response(pngBytes(1600, 1000)) }) as unknown as typeof fetch
    const { file, bytes } = await importFromWikimedia('https://commons.wikimedia.org/wiki/File:Jabal_Nur.jpg', fake)
    expect(file.license).toBe('CC BY-SA 4.0')
    expect(bytes.length).toBeGreaterThan(0)
    expect(urls.at(-1)).toContain('/thumb/') // too big: the 1600 px copy
    const nonfree = (async (u: string) => { urls.push(u); return json(info({}, { LicenseShortName: 'CC BY-NC 4.0' })) }) as unknown as typeof fetch
    const before = urls.length
    await expect(importFromWikimedia('https://commons.wikimedia.org/wiki/File:Jabal_Nur.jpg', nonfree)).rejects.toThrow(/Refused/)
    expect(urls.length - before).toBe(1) // only the API lookup: the image itself was never fetched
  })
  it('through the tool: a disallowed host is refused with the list of allowed ones; base64 and media_url together are refused', async () => {
    await seedEra()
    const token = await makeToken('owner-user', 'owner')
    const meta = { kind: 'landscape', alt: { bn: 'পাহাড়ের দৃশ্য' }, contains_people_confirmation: false }
    const r = await call(token, 'upload_media', { ...meta, media_url: 'https://example.com/hira.jpg' })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/not allowed.*upload\.wikimedia\.org/)
    expect((await call(token, 'upload_media', { ...meta, media_url: 'https://example.com/a.jpg', base64: 'AAAA' })).text).toMatch(/exactly one/)
    expect((await call(token, 'upload_media', { ...meta })).text).toMatch(/exactly one/)
  })
})
