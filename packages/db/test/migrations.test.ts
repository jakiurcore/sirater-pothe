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

// ───────────── data migration: single place → event_places, legacy types → region|city|site ─────────────
const apply = (d: DatabaseSync, files: string[]) => {
  for (const f of files) for (const stmt of readFileSync(join(dir, f), 'utf8').split('--> statement-breakpoint')) d.exec(stmt)
}
const files = () => readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const old = () => files().filter((f) => /^000[01]_/.test(f))
const upgrade = () => files().filter((f) => !/^000[01]_/.test(f))

describe('migration: event_places + place types + Zamzam event', () => {
  let d: DatabaseSync
  const q = (sql: string) => d.prepare(sql).all() as Record<string, unknown>[]
  beforeAll(() => {
    d = new DatabaseSync(':memory:')
    d.exec('PRAGMA foreign_keys = ON')
    apply(d, old()) // the schema as it was in production before this change
    d.exec(`
      insert into eras(id,slug,order_index) values('e1','era',1);
      insert into places(id,slug,type,lat,lng) values
        ('seed-place-makkah','makkah','city',21.4225,39.826),('seed-place-hira','hira','cave',21.45,39.85),
        ('seed-place-badr','badr','battlefield',23.7,38.7),('seed-place-mina','mina','valley',21.4,39.8),
        ('seed-place-banu-sad','banu-sad','region',21,40.6),('seed-place-quba','quba','site',24.4,39.6);
      insert into events(id,slug,era_id,order_index,place_id) values
        ('ev-zamzam','abdul-muttalib-rediscovers-zamzam','e1',1,'seed-place-makkah'),
        ('ev-elephant','year-of-the-elephant','e1',2,'seed-place-makkah'),
        ('ev-badr','battle-of-badr','e1',3,'seed-place-badr'),
        ('ev-none','no-place-yet','e1',4,NULL);
    `)
    apply(d, upgrade())
  })

  it('moves every existing events.place_id into event_places as primary', () => {
    const rows = q("select e.slug, p.slug as place, ep.role from event_places ep join events e on e.id=ep.event_id join places p on p.id=ep.place_id order by e.slug, ep.order_index")
    expect(rows).toEqual([
      { slug: 'abdul-muttalib-rediscovers-zamzam', place: 'zamzam', role: 'primary' },
      { slug: 'abdul-muttalib-rediscovers-zamzam', place: 'makkah', role: 'related' },
      { slug: 'battle-of-badr', place: 'badr', role: 'primary' },
      { slug: 'year-of-the-elephant', place: 'makkah', role: 'primary' },
    ])
    expect(q("select count(*) c from events where place_id is not null").at(0)!.c).toBe(3)
    // every pre-existing link survived: 3 events had a place before
    expect(q("select count(distinct event_id) c from event_places").at(0)!.c).toBe(3)
  })
  it('an event without a place gets no event_places row', () => {
    expect(q("select count(*) c from event_places where event_id='ev-none'")[0]!.c).toBe(0)
  })
  it('legacy place types become region | city | site, with a zoom for the wide ones', () => {
    const t = Object.fromEntries(q('select slug,type,zoom_override z from places').map((r) => [r.slug, [r.type, r.z]]))
    expect(t.makkah).toEqual(['city', null])
    expect(t['banu-sad']).toEqual(['region', null])
    expect(t.hira).toEqual(['site', 15])
    expect(t.badr).toEqual(['site', 13])
    expect(t.mina).toEqual(['site', 13])
    expect(t.quba).toEqual(['site', null])
    expect(q("select count(*) c from places where type not in ('region','city','site')")[0]!.c).toBe(0)
  })
  it('seeds the two Makkah sites as unverified children of Makkah, with names', () => {
    const r = q("select s.slug, s.type, s.verified, p.slug parent from places s left join places p on p.id=s.parent_place_id where s.slug in ('masjid-al-haram','zamzam') order by s.slug")
    expect(r).toEqual([
      { slug: 'masjid-al-haram', type: 'site', verified: 0, parent: 'makkah' },
      { slug: 'zamzam', type: 'site', verified: 0, parent: 'makkah' },
    ])
    expect(q("select count(*) c from place_translations where place_id in ('seed-place-masjid-al-haram','seed-place-zamzam')")[0]!.c).toBe(6)
  })
  it('sets ONLY the Zamzam event to the Zamzam site; the elephant event keeps Makkah; events.place_id mirrors the primary', () => {
    const prim = (slug: string) => q(`select p.slug s from event_places ep join events e on e.id=ep.event_id join places p on p.id=ep.place_id where e.slug='${slug}' and ep.role='primary'`)[0]!.s
    expect(prim('abdul-muttalib-rediscovers-zamzam')).toBe('zamzam')
    expect(prim('year-of-the-elephant')).toBe('makkah')
    expect(q("select place_id from events where slug='abdul-muttalib-rediscovers-zamzam'")[0]!.place_id).toBe('seed-place-zamzam')
    expect(q("select count(*) c from audit_log where tool like 'migration.0004%'")[0]!.c).toBe(1)
  })
  it('the database refuses a second primary place for one event', () => {
    expect(() => d.exec("insert into event_places(event_id,place_id,role) values('ev-badr','seed-place-hira','primary')")).toThrow(/UNIQUE/)
    d.exec("insert into event_places(event_id,place_id,role) values('ev-badr','seed-place-hira','related')")
    expect(() => d.exec("insert into event_places(event_id,place_id,role) values('ev-badr','seed-place-hira','related')")).toThrow(/UNIQUE|PRIMARY/)
  })
  it('deleting an event or a place cleans up its links', () => {
    d.exec("delete from events where id='ev-badr'")
    expect(q("select count(*) c from event_places where event_id='ev-badr'")[0]!.c).toBe(0)
  })
  it('the data migrations are idempotent (running them again changes nothing)', () => {
    const snap = () => JSON.stringify([q('select * from event_places order by 1,2'), q('select slug,type,zoom_override,parent_place_id from places order by slug'), q('select count(*) c from audit_log')])
    const before = snap()
    apply(d, upgrade().filter((f) => /^000[34]_/.test(f)))
    expect(snap()).toBe(before)
  })
  it('a fresh database (no Makkah yet) migrates cleanly and inserts no sites; the seed adds them later', () => {
    const f = new DatabaseSync(':memory:')
    apply(f, files())
    expect(f.prepare('select count(*) c from places').get()).toEqual({ c: 0 })
  })
  it('new media columns default sensibly', () => {
    d.exec("insert into media(id,r2_key,kind,mime,bytes) values('m1','k','landscape','image/png',1)")
    expect(q("select placement, after_index a, order_index o, credit, width from media where id='m1'")[0]).toEqual({ placement: 'gallery', a: null, o: 0, credit: null, width: null })
  })
})

// ───────────── shared placement model: ayat + media ─────────────
describe('migration: placement for ayat, after_index for media, upload tables', () => {
  let d: DatabaseSync
  const q = (sql: string) => d.prepare(sql).all() as Record<string, unknown>[]
  const upTo = (n: number) => files().filter((f) => Number(f.slice(0, 4)) <= n)
  const from = (n: number) => files().filter((f) => Number(f.slice(0, 4)) >= n)
  beforeAll(() => {
    d = new DatabaseSync(':memory:')
    d.exec('PRAGMA foreign_keys = ON')
    apply(d, upTo(4)) // production before this change
    d.exec(`
      insert into eras(id,slug,order_index) values('e1','era',1);
      insert into events(id,slug,era_id,order_index) values('v1','one','e1',1),('v2','two','e1',2);
      insert into ayat(id,surah,ayah,arabic_text,arabic_source) values('96:1',96,1,'x','s'),('96:2',96,2,'x','s'),('105:1',105,1,'x','s');
      insert into event_ayat(event_id,ayah_id,order_index) values('v1','96:1',0),('v1','96:2',1),('v2','105:1',0);
      insert into media(id,r2_key,kind,mime,bytes,event_id,placement,after_key_detail_index,order_index) values
        ('m-key','k1','landscape','image/png',1,'v1','in_key_details',2,0),
        ('m-hero','k2','landscape','image/png',1,'v1','hero',NULL,0),
        ('m-gal','k3','map','image/png',1,'v2','gallery',NULL,3);
    `)
    apply(d, from(5))
  })
  it('existing ayat keep their look: hero slot, ordered after any picture, relative order kept', () => {
    expect(q("select ayah_id a, placement p, after_index i, order_index o from event_ayat where event_id='v1' order by o")).toEqual([
      { a: '96:1', p: 'hero', i: null, o: 1000 }, { a: '96:2', p: 'hero', i: null, o: 1001 },
    ])
    expect(q("select placement p, order_index o from event_ayat where event_id='v2'")).toEqual([{ p: 'hero', o: 1000 }])
  })
  it('pictures keep their position: after_key_detail_index became after_index, the old column is gone', () => {
    expect(q("select id, placement p, after_index i, order_index o from media order by id")).toEqual([
      { id: 'm-gal', p: 'gallery', i: null, o: 3 }, { id: 'm-hero', p: 'hero', i: null, o: 0 }, { id: 'm-key', p: 'in_key_details', i: 2, o: 0 },
    ])
    expect(q("select name from pragma_table_info('media')").map((r) => r.name)).not.toContain('after_key_detail_index')
    expect(q("select name from pragma_table_info('media')").map((r) => r.name)).toEqual(expect.arrayContaining(['after_index', 'license', 'author', 'source_url', 'variants', 'sha256']))
  })
  it('creates the note, token and session tables; notes cascade with their event', () => {
    d.exec("insert into event_ayat_notes(event_id,ayah_id,lang,note) values('v1','96:1','bn','এই আয়াতে প্রথম ওহী')")
    expect(() => d.exec("insert into event_ayat_notes(event_id,ayah_id,lang,note) values('v1','96:1','bn','x')")).toThrow(/UNIQUE|PRIMARY/)
    d.exec("insert into upload_tokens(token_hash,mode,created_by,kind,placement,alt,expires_at) values('h','put','onset','map','gallery','{}','2099-01-01')")
    expect(q("select attempts a, used_at u from upload_tokens")).toEqual([{ a: 0, u: null }])
    d.exec("insert into upload_sessions(id,created_by,total_size,sha256,chunk_size,meta,expires_at) values('s1','onset',10,'x',32768,'{}','2099-01-01')")
    d.exec("delete from events where id='v1'")
    expect(q("select count(*) c from event_ayat_notes")[0]!.c).toBe(0)
  })
  it('the data migration can run again without changing anything', () => {
    const snap = () => JSON.stringify([q('select * from event_ayat order by 1,2'), q('select id,placement,after_index,order_index from media order by 1')])
    const before = snap()
    d.exec(readFileSync(join(dir, files().find((f) => f.startsWith('0006'))!), 'utf8').split('--> statement-breakpoint')[1]!) // the ayat step
    expect(snap()).toBe(before)
  })
  it('a fresh database migrates cleanly through every step', () => {
    const f = new DatabaseSync(':memory:')
    expect(() => apply(f, files())).not.toThrow()
  })
})
