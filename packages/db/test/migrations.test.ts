import { describe, it, expect, beforeAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableName, is } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '../src/schema'

const dir = join(import.meta.dirname, '..', 'migrations')
let db: DatabaseSync

beforeAll(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort())
    for (const stmt of readFileSync(join(dir, f), 'utf8').split('--> statement-breakpoint')) db.exec(stmt)
})

describe('migrations', () => {
  it('create every table in schema.ts', () => {
    const have = new Set((db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map((r) => r.name))
    const want = (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable => is(v, SQLiteTable)).map((t) => getTableName(t))
    expect(want.length).toBeGreaterThanOrEqual(25)
    for (const t of want) expect(have.has(t), t).toBe(true)
  })
  it('enforces unique slugs and foreign keys', () => {
    db.exec("insert into eras(id,slug,order_index) values('e1','makki',1)")
    expect(() => db.exec("insert into eras(id,slug,order_index) values('e2','makki',2)")).toThrow(/UNIQUE/)
    expect(() => db.exec("insert into events(id,slug,era_id,order_index) values('v1','x','nope',1)")).toThrow(/FOREIGN KEY/)
    db.exec("insert into events(id,slug,era_id,order_index) values('v1','x','e1',1)")
    const row = db.prepare("select status, certainty, needs_verification from events where id='v1'").get() as Record<string, unknown>
    expect(row).toMatchObject({ status: 'draft', certainty: 'agreed', needs_verification: 0 })
  })
  it('cascades translations when an event is deleted', () => {
    db.exec("insert into event_translations(event_id,lang,title,summary) values('v1','bn','t','s')")
    db.exec("delete from events where id='v1'")
    expect(db.prepare('select count(*) c from event_translations').get()).toEqual({ c: 0 })
  })
  it('stores each ayah once', () => {
    db.exec("insert into ayat(id,surah,ayah,arabic_text,arabic_source) values('a1',96,1,'x','s')")
    expect(() => db.exec("insert into ayat(id,surah,ayah,arabic_text,arabic_source) values('a2',96,1,'x','s')")).toThrow(/UNIQUE/)
  })
})
