// /api/groups: collection groups (decks, binders) and their totals, plus the
// group fields on /api/items.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../../db/types.ts'
import { recordSnapshot } from '../../lib/pricing/snapshots.ts'
import { createTestApi } from './harness.ts'

let api: Awaited<ReturnType<typeof createTestApi>>

const card = (
  productId: number,
  name: string,
  valueCents: number,
  qty = 1,
) => ({
  kind: 'card',
  name,
  quantity: qty,
  card: {
    categoryId: 1,
    groupId: 2098,
    productId,
    subType: 'Normal',
    setName: 'Rivals of Ixalan',
    imageUrl: `https://img.example/${productId}.jpg`,
  },
  acquisition: { mode: 'baseline', date: '2026-11-01', valueCents },
  observedPrice: { priceCents: valueCents / qty, asOf: '2026-11-01' },
})

const ids: Record<string, number> = {}
let ghalta: number

beforeAll(async () => {
  api = await createTestApi()
  for (const [key, body] of Object.entries({
    ghalta: card(1001, 'Ghalta, Primal Hunger', 500),
    craterhoof: card(1002, 'Craterhoof Behemoth', 4000),
    forest: card(1003, 'Forest', 30, 30),
    loose: card(1004, 'Beast Within', 100),
  })) {
    const res = await api.call('POST', '/items', body)
    expect(res.status).toBe(201)
    ids[key] = res.body.id
  }
})
afterAll(() => api.close())

describe('groups', () => {
  it('creates a group and refuses a duplicate name, whatever the case', async () => {
    const res = await api.call('POST', '/groups', { name: 'Ghalta' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name: 'Ghalta',
      itemCount: 0,
      cardCount: 0,
      marketCents: 0,
      imageUrl: null,
    })
    ghalta = res.body.id
    expect((await api.call('POST', '/groups', { name: 'ghalta' })).status).toBe(
      409,
    )
  })

  it('adds many items at once and adds them up', async () => {
    const res = await api.call('POST', `/groups/${ghalta}/items`, {
      itemIds: [ids.ghalta, ids.craterhoof, ids.forest],
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      itemCount: 3,
      cardCount: 32,
      costCents: 4530,
      marketCents: 4530,
      // No cover chosen: the most valuable card's picture.
      imageUrl: 'https://img.example/1002.jpg',
    })
    expect(res.body.items).toHaveLength(3)
  })

  it('values the group from the latest prices, with 7-day change', async () => {
    await recordSnapshot(
      api.db as unknown as Db,
      { source: 'tcgcsv', externalId: '1002', variant: 'Normal' },
      5000,
      '2026-11-09',
      true,
    )
    const g = (await api.call('GET', `/groups/${ghalta}`)).body
    expect(g.marketCents).toBe(500 + 5000 + 30)
    expect(g.weekChangeCents).toBe(1000)
  })

  it('uses a chosen cover, which must be one of its items', async () => {
    expect(
      (await api.call('PATCH', `/groups/${ghalta}`, { coverItemId: ids.loose }))
        .status,
    ).toBe(400)
    const res = await api.call('PATCH', `/groups/${ghalta}`, {
      coverItemId: ids.ghalta,
    })
    expect(res.body.imageUrl).toBe('https://img.example/1001.jpg')
  })

  it('shows the group on items, and filters by group', async () => {
    const item = (await api.call('GET', `/items/${ids.ghalta}`)).body
    expect(item.itemGroup).toEqual({ id: ghalta, name: 'Ghalta' })
    const inGroup = await api.call<any[]>('GET', `/items?itemGroup=${ghalta}`)
    expect(inGroup.body.map((i) => i.name).sort()).toEqual([
      'Craterhoof Behemoth',
      'Forest',
      'Ghalta, Primal Hunger',
    ])
    const none = await api.call<any[]>('GET', '/items?itemGroup=none')
    expect(none.body.map((i) => i.name)).toEqual(['Beast Within'])
  })

  it('moves an item between groups, and the cover leaves with it', async () => {
    const other = (await api.call('POST', '/groups', { name: 'Trade binder' }))
      .body.id
    await api.call('POST', `/groups/${other}/items`, { itemIds: [ids.ghalta] })
    const g = (await api.call('GET', `/groups/${ghalta}`)).body
    expect(g.coverItemId).toBeNull()
    expect(g.itemCount).toBe(2)
    // And back, via the item's own edit.
    const res = await api.call('PATCH', `/items/${ids.ghalta}`, {
      itemGroupId: ghalta,
    })
    expect(res.body.itemGroup.id).toBe(ghalta)
    expect(
      (await api.call('PATCH', `/items/${ids.ghalta}`, { itemGroupId: 99999 }))
        .status,
    ).toBe(400)
  })

  it('counts only unsold items, and a partial sale keeps the sold part in the group', async () => {
    const sale = await api.call('POST', `/items/${ids.forest}/sell`, {
      date: '2026-11-10',
      quantity: 10,
      proceedsCents: 0,
    })
    expect(sale.status).toBe(200)
    expect(sale.body.itemGroup?.id).toBe(ghalta)
    const g = (await api.call('GET', `/groups/${ghalta}`)).body
    expect(g.cardCount).toBe(1 + 1 + 20)
    expect(g.items).toHaveLength(4) // the sold copy is still listed
  })

  it('adds a new item straight into a group', async () => {
    const res = await api.call('POST', '/items', {
      ...card(1005, 'Garruk Wildspeaker', 800),
      itemGroupId: ghalta,
    })
    expect(res.body.itemGroup).toEqual({ id: ghalta, name: 'Ghalta' })
  })

  it('lists every group with its totals', async () => {
    const list = (await api.call<any[]>('GET', '/groups')).body
    expect(list.map((g) => [g.name, g.itemCount])).toEqual([
      ['Ghalta', 4],
      ['Trade binder', 0],
    ])
  })

  it('deletes a group and leaves its items in the collection', async () => {
    expect((await api.call('DELETE', `/groups/${ghalta}`)).status).toBe(200)
    const item = await api.call('GET', `/items/${ids.craterhoof}`)
    expect(item.status).toBe(200)
    expect(item.body.itemGroup).toBeNull()
  })
})
