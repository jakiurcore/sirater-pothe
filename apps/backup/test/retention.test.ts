import { describe, expect, it } from 'vitest'
import { backupKey, expiredKeys } from '../src/index'

const now = new Date('2026-10-09T02:00:00Z')

describe('backup retention', () => {
  it('names backups by UTC date', () => {
    expect(backupKey(now)).toBe('d1/2026-10-09.jsonl.gz')
  })
  it('keeps the last 30 days, deletes older', () => {
    const keys = ['d1/2026-10-09.jsonl.gz', 'd1/2026-09-10.jsonl.gz', 'd1/2026-09-09.jsonl.gz', 'd1/2026-08-01.jsonl.gz']
    expect(expiredKeys(keys, now, 30)).toEqual(['d1/2026-09-09.jsonl.gz', 'd1/2026-08-01.jsonl.gz'])
  })
  it('never deletes unrecognised names', () => {
    expect(expiredKeys(['d1/notes.txt', 'other/2020-01-01.jsonl.gz'], now, 30)).toEqual([])
  })
})
