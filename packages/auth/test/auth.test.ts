import { describe, expect, it } from 'vitest'
import { dummyHash, hashPassword, passwordProblem, timingSafeEqual, verifyPassword } from '../src/password'
import { base32Decode, base32Encode, generateSecret, hotp, otpauthUrl, totp, verifyTotp } from '../src/totp'

describe('password hashing', () => {
  it('round-trips, salts per hash, rejects wrong passwords', async () => {
    const a = await hashPassword('correct horse battery')
    const b = await hashPassword('correct horse battery')
    expect(a).not.toBe(b)
    expect(a.startsWith('pbkdf2-sha256$100000$')).toBe(true)
    expect(await verifyPassword('correct horse battery', a)).toBe(true)
    expect(await verifyPassword('correct horse batterz', a)).toBe(false)
    expect(await verifyPassword('', a)).toBe(false)
  })
  it('treats malformed or hostile stored values as a failed verification', async () => {
    for (const s of ['', 'x', 'argon2id$1$a$b', 'pbkdf2-sha256$0$a$b', 'pbkdf2-sha256$99999999999$a$b', 'pbkdf2-sha256$100000$$']) expect(await verifyPassword('x', s)).toBe(false)
  })
  it('normalises unicode (NFKC)', async () => {
    const h = await hashPassword('ｐassword-ünï-1234')
    expect(await verifyPassword('password-ünï-1234', h)).toBe(true)
  })
  it('dummy hash verifies nothing useful but is well formed', async () => {
    expect(await verifyPassword('anything', await dummyHash())).toBe(false)
  })
  it('timingSafeEqual', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(false)
  })
  it('policy', () => {
    expect(passwordProblem('short')).toBeTruthy()
    expect(passwordProblem('aaaaaaaaaaaaaaaa')).toBeTruthy()
    expect(passwordProblem('a long enough passphrase')).toBeNull()
  })
})

describe('TOTP (RFC 6238 vectors, SHA-1, secret "12345678901234567890")', () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'))
  it('matches the RFC 4226 HOTP vectors', async () => {
    const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
    for (let i = 0; i < want.length; i++) expect(await hotp(secret, i)).toBe(want[i])
  })
  it('matches the RFC 6238 time vectors (last 6 digits of the 8-digit values)', async () => {
    expect(await totp(secret, 59_000)).toBe('287082')
    expect(await totp(secret, 1_111_111_109_000)).toBe('081804')
    expect(await totp(secret, 1_234_567_890_000)).toBe('005924')
    expect(await totp(secret, 2_000_000_000_000)).toBe('279037')
  })
  it('accepts ±1 step, rejects ±2, rejects malformed', async () => {
    const t = 1_700_000_000_000
    const code = await totp(secret, t)
    expect(await verifyTotp(secret, code, t)).not.toBeNull()
    expect(await verifyTotp(secret, code, t + 30_000)).not.toBeNull()
    expect(await verifyTotp(secret, code, t - 30_000)).not.toBeNull()
    expect(await verifyTotp(secret, code, t + 90_000)).toBeNull()
    expect(await verifyTotp(secret, '12345', t)).toBeNull()
    expect(await verifyTotp(secret, 'abcdef', t)).toBeNull()
    expect(await verifyTotp(secret, ` ${code.slice(0, 3)} ${code.slice(3)} `, t)).not.toBeNull()
  })
  it('refuses replay of an already used step', async () => {
    const t = 1_700_000_000_000
    const code = await totp(secret, t)
    const step = await verifyTotp(secret, code, t)
    expect(step).not.toBeNull()
    expect(await verifyTotp(secret, code, t, step!)).toBeNull()
  })
  it('base32 round-trips and builds an otpauth URL', () => {
    const s = generateSecret()
    expect(base32Encode(base32Decode(s))).toBe(s)
    expect(otpauthUrl(s, 'a b')).toContain('otpauth://totp/Seerah%20Timeline:a%20b?secret=' + s)
  })
})
