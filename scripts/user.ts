#!/usr/bin/env tsx
/**
 * Account management for the MCP server. There is no signup page: this is the only way users are created.
 *
 *   pnpm user:create            create a user (owner or editor)
 *   pnpm user:reset-password    set a new password (also clears any lockout)
 *   pnpm user:enable-2fa        enable TOTP: prints a QR code, asks for a confirming code
 *   pnpm user:disable-2fa       remove TOTP from a user (lost phone)
 *   pnpm user:disable           disable a user (add --enable to re-enable)
 *
 * Writes to the REMOTE D1 database `seerah` (add --local for the local dev database).
 * Everything is interactive: usernames, passwords and codes are never accepted as command-line arguments.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import QRCode from 'qrcode'
import { hashPassword, passwordProblem } from '@seerah/auth/password'
import { generateSecret, otpauthUrl, verifyTotp } from '@seerah/auth/totp'

const ROOT = resolve(import.meta.dirname, '..')
const [cmd, ...flags] = process.argv.slice(2)
const local = flags.includes('--local')
const reEnable = flags.includes('--enable')
const stray = flags.filter((f) => !['--local', '--enable'].includes(f))
if (stray.length) {
  console.error('This command takes no arguments (only --local, and --enable for user:disable). Values are asked interactively; never pass passwords on the command line.')
  process.exit(2)
}

const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,31}$/
const q = (v: string) => `'${v.replace(/'/g, "''")}'`

function wrangler(args: string[]): string {
  return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'seerah', local ? '--local' : '--remote', '--yes', ...args], { cwd: join(ROOT, 'apps/mcp'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}
/** Runs SQL from a 0600 temp file, so hashes and TOTP seeds never appear in process arguments. */
function exec(sql: string) {
  const dir = mkdtempSync(join(tmpdir(), 'seerah-user-'))
  const file = join(dir, 'q.sql')
  try {
    writeFileSync(file, sql, { mode: 0o600 })
    wrangler(['--file', file])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
type Row = { id: string; username: string; role: string; totp_secret: string | null; totp_last_step: number | null; disabled_at: string | null }
function find(username: string): Row | undefined {
  const out = wrangler(['--json', '--command', `SELECT id, username, role, totp_secret, totp_last_step, disabled_at FROM users WHERE username = ${q(username)}`])
  return (JSON.parse(out) as { results: Row[] }[])[0]?.results[0]
}
const audit = (action: string, who: string) => `INSERT INTO audit_log (actor, role, tool, ok, detail) VALUES ('cli', NULL, ${q('cli.' + action)}, 1, ${q(JSON.stringify({ user: who }))});`

// Line queue instead of rl.question(): lines that arrive before a prompt is shown (piped input, fast paste) are kept, not lost.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
const queue: string[] = []
const waiters: ((l: string) => void)[] = []
let closed = false
rl.on('line', (l) => (waiters.length ? waiters.shift()!(l) : queue.push(l)))
rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()!('') })
const nextLine = () => new Promise<string>((res) => (queue.length ? res(queue.shift()!) : closed ? res('') : waiters.push(res)))

const ask = async (prompt: string) => {
  process.stdout.write(prompt)
  const l = await nextLine()
  if (!process.stdin.isTTY) process.stdout.write('\n')
  return l
}
/** Prompt without echo (TTY only; piped input is not echoed anyway). */
async function askHidden(prompt: string): Promise<string> {
  const out = rl as unknown as { _writeToOutput?: (s: string) => void }
  const orig = out._writeToOutput
  process.stdout.write(prompt)
  if (process.stdin.isTTY && orig) out._writeToOutput = () => {}
  const l = await nextLine()
  if (orig) out._writeToOutput = orig
  process.stdout.write('\n')
  return l
}

async function askUsername(mustExist: boolean): Promise<{ username: string; row?: Row }> {
  const username = (await ask('Username: ')).trim().toLowerCase()
  if (!USERNAME.test(username)) throw new Error('Username must be 3–32 chars: a-z, 0-9, dot, dash, underscore.')
  const row = find(username)
  if (mustExist && !row) throw new Error(`No user "${username}".`)
  if (!mustExist && row) throw new Error(`User "${username}" already exists (use user:reset-password).`)
  return { username, row }
}

async function askNewPassword(): Promise<string> {
  const p1 = await askHidden('Password (min 12 chars): ')
  const problem = passwordProblem(p1)
  if (problem) throw new Error(problem)
  if (p1 !== (await askHidden('Repeat password: '))) throw new Error('Passwords do not match.')
  return p1
}

async function main() {
  console.log(`Target: ${local ? 'LOCAL' : 'REMOTE'} D1 "seerah"`)
  switch (cmd) {
    case 'create': {
      const { username } = await askUsername(false)
      const role = (await ask('Role [owner/editor] (owner can publish): ')).trim().toLowerCase()
      if (role !== 'owner' && role !== 'editor') throw new Error('Role must be owner or editor.')
      const hash = await hashPassword(await askNewPassword())
      exec(`INSERT INTO users (id, username, password_hash, role) VALUES (${q(crypto.randomUUID())}, ${q(username)}, ${q(hash)}, ${q(role)});\n${audit('user.create', username)}`)
      console.log(`Created ${role} "${username}". Next: pnpm user:enable-2fa`)
      break
    }
    case 'reset-password': {
      const { username } = await askUsername(true)
      const hash = await hashPassword(await askNewPassword())
      exec(`UPDATE users SET password_hash = ${q(hash)}, failed_attempts = 0, locked_until = NULL WHERE username = ${q(username)};\n${audit('user.reset-password', username)}`)
      console.log(`Password changed for "${username}" (lockout cleared). Existing API tokens and sessions are unaffected; disable the user to cut them off.`)
      break
    }
    case 'enable-2fa': {
      const { username, row } = await askUsername(true)
      if (row?.totp_secret && (await ask('2FA is already enabled and will be REPLACED. Type "replace" to continue: ')).trim() !== 'replace') throw new Error('Aborted.')
      const secret = generateSecret()
      console.log('\nScan this QR code with an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password…):\n')
      console.log(await QRCode.toString(otpauthUrl(secret, username), { type: 'terminal', small: true }))
      console.log(`Or enter this key manually: ${secret}\n`)
      const step = await verifyTotp(secret, await ask('Enter the 6-digit code now showing in the app: '))
      if (step === null) throw new Error('That code is not valid; 2FA was NOT enabled. Run the command again.')
      exec(`UPDATE users SET totp_secret = ${q(secret)}, totp_last_step = ${step} WHERE username = ${q(username)};\n${audit('user.enable-2fa', username)}`)
      console.log(`2FA enabled for "${username}". Sign-in now asks for the code.`)
      break
    }
    case 'disable-2fa': {
      const { username } = await askUsername(true)
      if ((await ask(`Remove 2FA from "${username}"? Type "yes": `)).trim() !== 'yes') throw new Error('Aborted.')
      exec(`UPDATE users SET totp_secret = NULL, totp_last_step = NULL WHERE username = ${q(username)};\n${audit('user.disable-2fa', username)}`)
      console.log(`2FA removed from "${username}".`)
      break
    }
    case 'disable': {
      const { username } = await askUsername(true)
      exec(`UPDATE users SET disabled_at = ${reEnable ? 'NULL' : `strftime('%Y-%m-%dT%H:%M:%fZ','now')`}${reEnable ? ', failed_attempts = 0, locked_until = NULL' : ''} WHERE username = ${q(username)};\n${audit(reEnable ? 'user.enable' : 'user.disable', username)}`)
      console.log(reEnable ? `"${username}" re-enabled.` : `"${username}" disabled: cannot sign in, and their sessions and API tokens stop working immediately.`)
      break
    }
    default:
      console.error('Usage: pnpm user:create | user:reset-password | user:enable-2fa | user:disable-2fa | user:disable [--enable] [--local]')
      process.exitCode = 2
  }
}

main().catch((e) => { console.error(`\nError: ${e instanceof Error ? e.message : e}`); process.exitCode = 1 }).finally(() => rl.close())
