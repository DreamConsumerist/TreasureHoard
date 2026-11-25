// The collection-accounts seed runs against production, which already holds
// data. It must adopt matching accounts and never fail on a name collision.

import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApi } from './harness.ts'

const dir = 'netlify/database/migrations'
const seedFile = readdirSync(dir).find((d) =>
  d.endsWith('_collection_accounts'),
)!
const seedSql = readFileSync(`${dir}/${seedFile}/migration.sql`, 'utf-8')

let api: Awaited<ReturnType<typeof createTestApi>>
beforeAll(async () => {
  api = await createTestApi()
})
afterAll(() => api.close())

const rows = async () =>
  (
    await api.client.query<{
      id: number
      name: string
      type: string
      system_key: string | null
    }>(`select id, name, type, system_key from accounts order by id`)
  ).rows

describe('collection accounts seed', () => {
  it('adopts a same-named account instead of duplicating it, and is safe to re-run', async () => {
    // Simulate production before the deploy: a user-made "Collection" asset
    // (with no system key yet), and "Cards" freed of its key.
    await api.client.exec(`
      update accounts set system_key = null where system_key in ('collection', 'collection_card');
    `)
    const before = await rows()
    const userCollection = before.find((a) => a.name === 'Collection')!

    await api.client.exec(seedSql)
    const after = await rows()
    expect(after).toHaveLength(before.length) // nothing duplicated
    expect(after.find((a) => a.id === userCollection.id)!.system_key).toBe(
      'collection',
    )
    expect(after.find((a) => a.name === 'Cards')!.system_key).toBe(
      'collection_card',
    )

    await api.client.exec(seedSql) // re-running changes nothing
    expect(await rows()).toEqual(after)
  })

  it('creates a suffixed account when the name is taken by a different type', async () => {
    await api.client.exec(`
      update accounts set system_key = null where system_key = 'realized_gains';
      update accounts set name = 'Old gains', type = 'income' where name = 'Realized Gains on Collection';
      insert into accounts (name, type) values ('Realized Gains on Collection', 'expense');
    `)
    await api.client.exec(seedSql)
    const gains = (await rows()).find((a) => a.system_key === 'realized_gains')!
    expect(gains).toMatchObject({
      name: 'Realized Gains on Collection (Collection)',
      type: 'income',
    })
  })
})
