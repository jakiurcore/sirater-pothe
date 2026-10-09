/** Byte-level image fixtures: structurally valid (headers, segments, chunks), not decodable pictures. */
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const ascii = (t: string) => [...t].map((c) => c.charCodeAt(0))
const cat = (...p: number[][]) => Uint8Array.from(p.flat())

export const pngChunk = (type: string, data: number[]) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0]
export function pngBytes(w = 8, h = 6, extra: { type: string; data: number[] }[] = [], idat = 16): Uint8Array {
  return cat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk('IHDR', [...be32(w), ...be32(h), 8, 2, 0, 0, 0]),
    ...extra.map((c) => pngChunk(c.type, c.data)),
    pngChunk('IDAT', Array.from({ length: idat }, (_, i) => (i * 7 + 3) & 255)),
    pngChunk('IEND', []),
  )
}

/** A TIFF/EXIF block with an orientation tag and some "private" text (a fake GPS string and camera model). */
export const exifBlock = (orientation = 1) => [
  ...ascii('Exif'), 0, 0,
  0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, // II, 42, IFD at 8
  1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0, // 1 entry: Orientation (SHORT)
  ...ascii('GPSLatitudeRef=N;GPS=21.4225,39.8262;Model=SecretCam'),
]
const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]
export function jpegBytes(w = 40, h = 30, o: { exif?: boolean; orientation?: number; comment?: string; xmp?: boolean } = {}): Uint8Array {
  return cat(
    [0xff, 0xd8],
    seg(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    o.exif ? seg(0xe1, exifBlock(o.orientation ?? 1)) : [],
    o.xmp ? seg(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta>SecretXmp</x:xmpmeta>')]) : [],
    o.comment ? seg(0xfe, ascii(o.comment)) : [],
    seg(0xed, [...ascii('Photoshop 3.0'), 0, ...ascii('IPTC-Caption-Secret')]),
    seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    Array.from({ length: 40 }, (_, i) => (i * 13 + 5) & 0x7f), // entropy-coded data (no 0xFF)
    [0xff, 0xd9],
  )
}

const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
const riffChunk = (t: string, d: number[]) => [...ascii(t), ...le32(d.length), ...d, ...(d.length & 1 ? [0] : [])]
export function webpBytes(w = 64, h = 48, o: { exif?: boolean; xmp?: boolean } = {}): Uint8Array {
  const flags = (o.exif ? 0x08 : 0) | (o.xmp ? 0x04 : 0)
  const vp8x = riffChunk('VP8X', [flags, 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0])
  const body = [...ascii('WEBP'), ...vp8x, ...riffChunk('VP8 ', Array.from({ length: 20 }, (_, i) => i)), ...(o.exif ? riffChunk('EXIF', exifBlock().slice(6)) : []), ...(o.xmp ? riffChunk('XMP ', ascii('<x:xmpmeta>SecretXmp</x:xmpmeta>')) : [])]
  return cat(ascii('RIFF'), le32(body.length), body)
}

export const b64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
export const has = (b: Uint8Array, text: string) => { const t = ascii(text); for (let i = 0; i + t.length <= b.length; i++) if (t.every((c, k) => b[i + k] === c)) return true; return false }
export const sha256 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('')
