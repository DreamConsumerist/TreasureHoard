// GET /api/catalog/tcg/search: finding a card by name across every set.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { catalogGroups, catalogProducts } from '../../db/schema.ts'
import type { Db } from '../../db/types.ts'
import { createTestApi } from './harness.ts'

let api: Awaited<ReturnType<typeof createTestApi>>

const search = async (query: string) =>
  (await api.call<any>('GET', `/catalog/tcg/search?${query}`)).body

beforeAll(async () => {
  api = await createTestApi()
})
afterAll(() => api.close())

describe('card search', () => {
  it('says the index is not built yet', async () => {
    expect(await search('game=mtg&q=ghalta')).toEqual({
      indexed: false,
      results: [],
    })
  })

  it('finds every printing by name, best match and newest set first', async () => {
    const db = api.db as unknown as Db
    await db.insert(catalogGroups).values([
      {
        groupId: 1,
        categoryId: 1,
        name: 'Rivals of Ixalan',
        abbreviation: 'RIX',
        publishedOn: '2018-01-19',
        productsSyncedAt: new Date(),
      },
      {
        groupId: 2,
        categoryId: 1,
        name: 'Commander Masters',
        abbreviation: 'CMM',
        publishedOn: '2023-08-04',
        productsSyncedAt: new Date(),
      },
      {
        groupId: 3,
        categoryId: 68,
        name: 'Romance Dawn',
        abbreviation: 'OP01',
        publishedOn: '2022-12-02',
        productsSyncedAt: new Date(),
      },
    ])
    await db.insert(catalogProducts).values([
      {
        productId: 10,
        categoryId: 1,
        groupId: 1,
        name: 'Ghalta, Primal Hunger',
        number: '130',
        rarity: 'R',
        sealed: false,
      },
      {
        productId: 11,
        categoryId: 1,
        groupId: 2,
        name: 'Ghalta, Primal Hunger',
        number: '292',
        rarity: 'R',
        sealed: false,
      },
      {
        productId: 12,
        categoryId: 1,
        groupId: 2,
        name: 'Ghalta, Primal Hunger (Foil Etched)',
        number: '561',
        rarity: 'R',
        sealed: false,
      },
      {
        productId: 13,
        categoryId: 1,
        groupId: 2,
        name: 'Ghalta and Mavren',
        number: '1',
        rarity: 'M',
        sealed: false,
      },
      {
        productId: 14,
        categoryId: 1,
        groupId: 2,
        name: 'Commander Masters Ghalta Deck',
        sealed: true,
      },
      {
        productId: 15,
        categoryId: 68,
        groupId: 3,
        name: 'Ghalta Imposter',
        number: 'OP01-1',
        rarity: 'C',
        sealed: false,
      },
      {
        productId: 16,
        categoryId: 1,
        groupId: 1,
        name: '100% Pure',
        number: '9',
        rarity: 'C',
        sealed: false,
      },
    ])

    const r = await search('game=mtg&q=Ghalta, Primal Hunger&sealed=false')
    expect(r.indexed).toBe(true)
    expect(
      r.results.map((x: any) => [x.productId, x.setName, x.setCode]),
    ).toEqual([
      [11, 'Commander Masters', 'CMM'], // exact name, newer set
      [10, 'Rivals of Ixalan', 'RIX'], // exact name
      [12, 'Commander Masters', 'CMM'], // starts with the query
    ])
  })

  it('matches every word in any order, case-insensitively, within one game', async () => {
    const r = await search('game=mtg&q=hunger GHALTA')
    expect(r.results.map((x: any) => x.productId).sort()).toEqual([10, 11, 12])
    const op = await search('game=onepiece&q=ghalta')
    expect(op.results.map((x: any) => x.productId)).toEqual([15])
  })

  it('filters cards or sealed, and by set', async () => {
    expect(
      (await search('game=mtg&q=ghalta&sealed=true')).results.map(
        (x: any) => x.productId,
      ),
    ).toEqual([14])
    expect(
      (await search('game=mtg&q=ghalta&sealed=false&groupId=1')).results.map(
        (x: any) => x.productId,
      ),
    ).toEqual([10])
  })

  it('treats % and _ literally', async () => {
    expect(
      (await search('game=mtg&q=100%25')).results.map((x: any) => x.productId),
    ).toEqual([16])
    expect((await search('game=mtg&q=10_')).results).toEqual([])
  })

  it('needs at least two characters', async () => {
    expect(
      (await api.call('GET', '/catalog/tcg/search?game=mtg&q=g')).status,
    ).toBe(400)
  })
})
