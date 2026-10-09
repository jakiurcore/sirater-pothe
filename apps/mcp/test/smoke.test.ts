import { describe, it, expect, beforeAll } from 'vitest'
import { call, makeToken, rpc, seedEra } from './helpers'

let owner: string
beforeAll(async () => { await seedEra(); owner = await makeToken('owner-user', 'owner') })

describe('transport + auth', () => {
  it('rejects unauthenticated requests with a bearer challenge', async () => {
    const r = await rpc(null, 'tools/list')
    expect(r.status).toBe(401)
  })
  it('lists tools', async () => {
    const r = await rpc(owner, 'tools/list')
    console.log(r.status, r.raw.slice(0, 600))
    expect(r.status).toBe(200)
    expect(r.body.result.tools.length).toBe(43)
  })
  it('list_eras works', async () => {
    const r = await call(owner, 'list_eras', {})
    console.log(r.text)
    expect(r.isError).toBe(false)
  })
})
