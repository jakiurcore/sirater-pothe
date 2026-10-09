/**
 * Metadata stripping by editing the file's own structure: no decoding, no re-encoding, so pixels are untouched.
 * Removes EXIF (camera, GPS, timestamps), XMP, IPTC and text comments from JPEG, PNG and WebP.
 * Orientation is read first: a rotated JPEG loses its orientation tag when EXIF goes, so the caller must bake the
 * rotation into the pixels (or refuse the file) instead of publishing it sideways.
 */
export interface Stripped { bytes: Uint8Array; removed: string[]; orientation: number }

const ascii = (b: Uint8Array, i: number, t: string) => [...t].every((c, k) => b[i + k] === c.charCodeAt(0))
const u16 = (b: Uint8Array, i: number, le: boolean) => (le ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!)
const u32 = (b: Uint8Array, i: number, le: boolean) => (le ? (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0 : ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0)

/** Orientation (1–8) from a TIFF/EXIF block; 1 when absent. */
export function exifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 14) return 1
  const le = tiff[0] === 0x49
  if (!(le || tiff[0] === 0x4d)) return 1
  const ifd = u32(tiff, 4, le)
  if (ifd + 2 > tiff.length) return 1
  const n = u16(tiff, ifd, le)
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > tiff.length) break
    if (u16(tiff, e, le) === 0x0112) { const v = u16(tiff, e + 8, le); return v >= 1 && v <= 8 ? v : 1 }
  }
  return 1
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

export function stripJpeg(b: Uint8Array): Stripped {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG')
  const parts: Uint8Array[] = [b.subarray(0, 2)]
  const removed: string[] = []
  let orientation = 1
  let i = 2
  let sawScan = false
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('corrupt JPEG: expected a marker')
    const m = b[i + 1]!
    if (m === 0xff) { i++; continue }
    if (m === 0xda) { parts.push(b.subarray(i)); sawScan = true; i = b.length; break } // start of scan: everything after is entropy-coded data
    if (m === 0xd9) { parts.push(b.subarray(i, i + 2)); sawScan = true; i = b.length; break }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { parts.push(b.subarray(i, i + 2)); i += 2; continue }
    const len = u16(b, i + 2, false)
    if (len < 2 || i + 2 + len > b.length) throw new Error('corrupt JPEG: bad segment length')
    const seg = b.subarray(i, i + 2 + len)
    const body = seg.subarray(4)
    let drop: string | null = null
    if (m === 0xe1) { // APP1: Exif or XMP
      if (ascii(body, 0, 'Exif\0\0')) { orientation = exifOrientation(body.subarray(6)); drop = 'EXIF' } else drop = 'XMP/APP1'
    } else if (m === 0xed) drop = 'IPTC/Photoshop'
    else if (m === 0xfe) drop = 'comment'
    else if (m === 0xe2 && !ascii(body, 0, 'ICC_PROFILE')) drop = 'APP2 (non-ICC)'
    else if (m >= 0xe3 && m <= 0xef && m !== 0xee) drop = `APP${m - 0xe0}`
    else if (m === 0xe0 && !ascii(body, 0, 'JFIF')) drop = 'APP0 (non-JFIF)'
    if (drop) removed.push(drop); else parts.push(seg)
    i += 2 + len
  }
  if (!sawScan) throw new Error('corrupt JPEG: no image data')
  return { bytes: concat(parts), removed, orientation }
}

const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT'])
export function stripPng(b: Uint8Array): Stripped {
  if (!(b[0] === 0x89 && ascii(b, 1, 'PNG'))) throw new Error('not a PNG')
  const parts: Uint8Array[] = [b.subarray(0, 8)]
  const removed: string[] = []
  let i = 8
  while (i + 12 <= b.length) {
    const len = u32(b, i, false)
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!)
    const end = i + 12 + len
    if (end > b.length) throw new Error('corrupt PNG: chunk past the end')
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end)); else removed.push(type === 'eXIf' ? 'EXIF' : type)
    i = end
    if (type === 'IEND') break
  }
  return { bytes: concat(parts), removed, orientation: 1 }
}

export function stripWebp(b: Uint8Array): Stripped {
  if (!(ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'))) throw new Error('not a WebP')
  const chunks: Uint8Array[] = []
  const removed: string[] = []
  let i = 12
  let orientation = 1
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!)
    const size = u32(b, i + 4, true)
    const end = i + 8 + size + (size & 1)
    if (i + 8 + size > b.length) throw new Error('corrupt WebP: chunk past the end')
    const whole = b.subarray(i, Math.min(end, b.length))
    if (type === 'EXIF') { orientation = exifOrientation(b.subarray(i + 8, i + 8 + size)); removed.push('EXIF') }
    else if (type === 'XMP ') removed.push('XMP')
    else if (type === 'VP8X') { const c = whole.slice(); c[8] = c[8]! & ~0x0c; chunks.push(c) } // clear the EXIF and XMP flags
    else chunks.push(whole)
    i = end
  }
  const body = concat(chunks)
  const out = new Uint8Array(12 + body.length)
  out.set(b.subarray(0, 4), 0)
  new DataView(out.buffer).setUint32(4, 4 + body.length, true)
  out.set(b.subarray(8, 12), 8)
  out.set(body, 12)
  return { bytes: out, removed, orientation }
}

export function stripMetadata(bytes: Uint8Array, mime: string): Stripped {
  if (mime === 'image/jpeg') return stripJpeg(bytes)
  if (mime === 'image/png') return stripPng(bytes)
  if (mime === 'image/webp') return stripWebp(bytes)
  throw new Error(`cannot strip ${mime}`)
}

/** True if the file still carries EXIF / XMP / IPTC / text chunks (used by tests and as a last check before storing). */
export function hasMetadata(bytes: Uint8Array, mime: string): boolean {
  try { return stripMetadata(bytes, mime).removed.length > 0 } catch { return true }
}
