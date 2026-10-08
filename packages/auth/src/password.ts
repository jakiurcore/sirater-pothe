/**
 * Password hashing with WebCrypto only, so the same code runs in Workers and in the Node CLI.
 *
 * Why PBKDF2-SHA256 and not argon2id: argon2id needs WebAssembly, and Workers forbids compiling WASM from bytes at runtime
 * (only statically imported modules), the common pure-JS/inlined-WASM argon2 packages therefore do not run, and argon2id's
 * ~20 MiB memory cost would also blow the CPU limit of the free plan. Workers' PBKDF2 caps iterations at 100,000
 * (anything higher throws NotSupportedError), so that is what we use; the stored iteration count lets us raise it later.
 * The weaker KDF is compensated by: random 128-bit per-user salt, lockout after 5 failures, per-IP rate limiting, optional TOTP.
 *
 * Stored format: pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>
 */
export const PBKDF2_ITERATIONS = 100_000
const ALGO = 'pbkdf2-sha256'
const enc = new TextEncoder()

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

/** Constant-time equality for byte arrays (length difference is not secret here: both are fixed size). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256))
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${ALGO}$${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split('$')
  const iterations = Number(iter)
  if (algo !== ALGO || !Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000 || !salt || !hash) return false
  return timingSafeEqual(await derive(password, unb64(salt), iterations), unb64(hash))
}

/** A valid-looking hash of a random password, used to spend the same time when the username does not exist. */
let dummy: Promise<string> | undefined
export const dummyHash = () => (dummy ??= hashPassword(crypto.randomUUID()))

export const MIN_PASSWORD_LENGTH = 12
export function passwordProblem(p: string): string | null {
  if (p.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (new Set(p).size < 5) return 'Too repetitive.'
  return null
}
