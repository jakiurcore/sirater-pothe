/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), base32 per RFC 4648. WebCrypto only. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const STEP = 30
export const DIGITS = 6

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '')
  const out: number[] = []
  let bits = 0, value = 0
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) throw new Error('invalid base32')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Uint8Array.from(out)
}

export const generateSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)))

export async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const msg = new ArrayBuffer(8)
  const view = new DataView(msg)
  view.setUint32(0, Math.floor(counter / 2 ** 32))
  view.setUint32(4, counter >>> 0)
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const o = h[h.length - 1]! & 15
  const code = (((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 10 ** DIGITS
  return String(code).padStart(DIGITS, '0')
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP)
export const totp = (secret: string, ms = Date.now()) => hotp(secret, stepAt(ms))

/**
 * Checks a code within ±1 step of clock drift. Returns the matched step or null.
 * `lastStep`: the last step already accepted for this user; the same or an earlier step is refused (replay protection).
 */
export async function verifyTotp(secret: string, code: string, ms = Date.now(), lastStep = -1): Promise<number | null> {
  const c = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) return null
  const now = stepAt(ms)
  let matched: number | null = null
  for (const step of [now - 1, now, now + 1]) {
    // No early exit: always evaluates all three, so timing does not reveal which step matched.
    const ok = (await hotp(secret, step)) === c
    if (ok && step > lastStep && matched === null) matched = step
  }
  return matched
}

export const otpauthUrl = (secret: string, account: string, issuer = 'Seerah Timeline') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`
