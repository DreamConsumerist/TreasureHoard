// Collection integration tests: real routes and migrations on PGlite, with a
// fake fetch standing in for TCGCSV and PriceCharting. After every step the
// Collection invariant (ledger = summed basis of unsold items) must hold.

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApi } from './harness.ts'

const pcPage = readFileSync(
  'tests/fixtures/pricecharting/super-mario-world.html',
  'utf-8',
)
const fetched: string[] = []
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input)
  fetched.push(url)
  const json = (results: unknown[]) =>
    new Response(JSON.stringify({ success: true, results }))
  if (url.endsWith('/89/groups')) {
    return json([
      {
        groupId: 24943,
        name: 'K/DA',
        abbreviation: 'KDA',
        publishedOn: '2026-11-11T00:00:00',
      },
    ])
  }
  if (url.endsWith('/24943/products')) {
    return json([
      {
        productId: 732649,
        name: 'K/DA Bundle',
        imageUrl: null,
        extendedData: [],
      },
    ])
  }
  if (url.endsWith('/24943/prices')) {
    return json([
      {
        productId: 732649,
        subTypeName: 'Normal',
        marketPrice: 256.03,
        lowPrice: 230,
      },
    ])
  }
  if (url.startsWith('https://www.pricecharting.com/game/'))
    return new Response(pcPage)
  return new Response('not found', { status: 404 })
}) as typeof fetch

let api: Awaited<ReturnType<typeof createTestApi>>
const acct: Record<string, number> = {}

beforeAll(async () => {
  api = await createTestApi({ fetch: fakeFetch })
  const { body } = await api.call<any[]>('GET', '/accounts')
  for (const a of body) acct[a.systemKey ?? a.name] = a.id
})
afterAll(() => api.close())

const check = async () => (await api.call('GET', '/collection/check')).body
const balance = async (key: string) =>
  ((await api.call<any[]>('GET', '/accounts')).body as any[]).find(
    (a) => a.id === acct[key],
  ).balanceCents

const card = {
  categoryId: 68,
  groupId: 100,
  productId: 5555,
  subType: 'Normal',
  setName: 'Romance Dawn',
  number: 'OP01-001',
  rarity: 'Leader',
  imageUrl: null,
}

describe('seeded accounts', () => {
  it('has the Collection tree and Realized Gains', () => {
    for (const key of [
      'collection',
      'collection_card',
      'collection_sealed',
      'collection_game',
      'collection_hardware',
      'realized_gains',
    ]) {
      expect(acct[key]).toBeTypeOf('number')
    }
  })
})

describe('catalog lookup', () => {
  it('lists sets and a set’s products with prices in cents', async () => {
    const groups = await api.call('GET', '/catalog/tcg/groups?game=riftbound')
    expect(groups.body[0].groupId).toBe(24943)
    const products = await api.call(
      'GET',
      '/catalog/tcg/products?game=riftbound&groupId=24943',
    )
    expect(products.body[0]).toMatchObject({ productId: 732649, sealed: true })
    expect(products.body[0].prices[0].marketCents).toBe(25603)
  })

  it('caches a set’s catalog within the function instance', async () => {
    const before = fetched.length
    await api.call('GET', '/catalog/tcg/products?game=riftbound&groupId=24943')
    expect(fetched.length).toBe(before)
  })

  it('looks up a PriceCharting page and rejects other URLs', async () => {
    const ok = await api.call('POST', '/catalog/pricecharting', {
      url: 'https://www.pricecharting.com/game/super-nintendo/super-mario-world',
    })
    expect(ok.body).toMatchObject({
      name: 'Super Mario World',
      platform: 'Super Nintendo',
      path: '/game/super-nintendo/super-mario-world',
      prices: { loose: 1989, cib: 63503, new: 188000 },
      imageUrl:
        'https://storage.googleapis.com/images.pricecharting.com/w4tqsjcg7clrvypq/240.jpg',
    })
    const bad = await api.call('POST', '/catalog/pricecharting', {
      url: 'https://example.com/x',
    })
    expect(bad.status).toBe(400)
  })
})

describe('items', () => {
  let ownedCardId: number
  let boughtBoxId: number

  it('adds an already-owned card at market value as a hidden opening entry', async () => {
    const res = await api.call('POST', '/items', {
      kind: 'card',
      name: 'Monkey.D.Luffy',
      quantity: 3,
      card,
      acquisition: { mode: 'baseline', date: '2026-11-20', valueCents: 3000 },
      observedPrice: { priceCents: 1000, asOf: '2026-11-20' },
    })
    expect(res.status).toBe(201)
    ownedCardId = res.body.id
    expect(res.body).toMatchObject({
      basisSource: 'baseline',
      costBasisCents: 3000,
      unitPriceCents: 1000,
      priceAsOf: '2026-11-20',
    })
    expect(await balance('collection_card')).toBe(3000)
    const txn = await api.call('GET', `/transactions/${res.body.acquiredTxnId}`)
    expect(txn.body.kind).toBe('opening')
    expect(txn.body.linkedItemId).toBe(ownedCardId)
    expect((await check()).ok).toBe(true)
  })

  it('adds a bought sealed box as a purchase from Checking', async () => {
    const before = await balance('Checking')
    const res = await api.call('POST', '/items', {
      kind: 'sealed',
      name: 'K/DA Bundle',
      card: {
        ...card,
        categoryId: 89,
        groupId: 24943,
        productId: 732649,
        number: null,
        rarity: null,
      },
      acquisition: {
        mode: 'purchase',
        date: '2026-11-21',
        costCents: 22000,
        fromAccountId: acct.Checking,
      },
      observedPrice: { priceCents: 25603, asOf: '2026-11-21' },
    })
    expect(res.status).toBe(201)
    boughtBoxId = res.body.id
    expect(await balance('Checking')).toBe(before - 22000)
    expect(await balance('collection_sealed')).toBe(22000)
    expect((await check()).ok).toBe(true)
  })

  it('refuses to buy from a Collection account', async () => {
    const res = await api.call('POST', '/items', {
      kind: 'card',
      name: 'X',
      card,
      acquisition: {
        mode: 'purchase',
        date: '2026-11-21',
        costCents: 100,
        fromAccountId: acct.collection_sealed,
      },
    })
    expect(res.status).toBe(400)
  })

  it("stores and returns a game's cover photo", async () => {
    const res = await api.call('POST', '/items', {
      kind: 'game',
      name: 'Super Mario World',
      game: {
        platform: 'Super Nintendo',
        url: 'https://www.pricecharting.com/game/super-nintendo/super-mario-world',
        variant: 'cib',
        imageUrl:
          'https://storage.googleapis.com/images.pricecharting.com/w4tqsjcg7clrvypq/240.jpg',
      },
      acquisition: { mode: 'baseline', date: '2026-11-21', valueCents: 63503 },
    })
    expect(res.status).toBe(201)
    const got = await api.call('GET', `/items/${res.body.id}`)
    expect(got.body.game.imageUrl).toBe(
      'https://storage.googleapis.com/images.pricecharting.com/w4tqsjcg7clrvypq/240.jpg',
    )
  })

  it('adds a $0 item without booking anything', async () => {
    const res = await api.call('POST', '/items', {
      kind: 'hardware',
      name: 'Old cable',
      game: { platform: 'Nintendo 3DS', url: null, variant: 'loose' },
      acquisition: { mode: 'baseline', date: '2026-11-21', valueCents: 0 },
    })
    expect(res.status).toBe(201)
    expect(res.body.acquiredTxnId).toBeNull()
    expect((await check()).ok).toBe(true)
  })

  it('records a manual price for an unlisted item, and refuses one for a looked-up item', async () => {
    const manual = await api.call('POST', '/items', {
      kind: 'hardware',
      name: 'Collector 3DS',
      game: { platform: 'Nintendo 3DS', url: null, variant: 'cib' },
      acquisition: { mode: 'baseline', date: '2026-11-21', valueCents: 40000 },
      observedPrice: { priceCents: 40000, asOf: '2026-11-21' },
    })
    const patched = await api.call('PATCH', `/items/${manual.body.id}`, {
      manualPriceCents: 42500,
      today: '2026-11-22',
    })
    expect(patched.body).toMatchObject({
      unitPriceCents: 42500,
      priceAsOf: '2026-11-22',
    })
    const refused = await api.call('PATCH', `/items/${ownedCardId}`, {
      manualPriceCents: 1,
    })
    expect(refused.status).toBe(400)
  })

  it('editing the cost basis rewrites the linked transaction', async () => {
    await api.call('PATCH', `/items/${boughtBoxId}`, {
      costBasisCents: 21000,
      acquiredDate: '2026-11-19',
    })
    expect(await balance('collection_sealed')).toBe(21000)
    const item = (await api.call('GET', `/items/${boughtBoxId}`)).body
    const txn = (await api.call('GET', `/transactions/${item.acquiredTxnId}`))
      .body
    expect(txn.date).toBe('2026-11-19')
    expect(txn.postings.map((p: any) => p.amountCents).sort()).toEqual([
      -21000, 21000,
    ])
    expect((await check()).ok).toBe(true)
  })

  it('protects linked transactions from ledger edits and the Collection from direct postings', async () => {
    const item = (await api.call('GET', `/items/${boughtBoxId}`)).body
    const put = await api.call('PUT', `/transactions/${item.acquiredTxnId}`, {
      date: '2026-11-19',
      description: 'hack',
      postings: [
        { accountId: acct.collection_sealed, amountCents: 1 },
        { accountId: acct.Checking, amountCents: -1 },
      ],
    })
    expect(put.status).toBe(409)
    expect(
      (await api.call('DELETE', `/transactions/${item.acquiredTxnId}`)).status,
    ).toBe(409)
    const direct = await api.call('POST', '/transactions', {
      date: '2026-11-19',
      description: 'manual',
      postings: [
        { accountId: acct.collection_card, amountCents: 500 },
        { accountId: acct.Checking, amountCents: -500 },
      ],
    })
    expect(direct.status).toBe(400)
  })

  it('guards system accounts and the Collection structure', async () => {
    expect(
      (
        await api.call('PATCH', `/accounts/${acct.collection_card}`, {
          archived: true,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api.call('PATCH', `/accounts/${acct.collection_card}`, {
          parentId: null,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api.call('POST', '/accounts', {
          name: 'MTG',
          type: 'asset',
          parentId: acct.collection_card,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api.call('PATCH', `/accounts/${acct.collection_card}`, {
          openingBalanceCents: 100,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api.call('PATCH', `/accounts/${acct.collection_card}`, {
          name: 'TCG Cards',
        })
      ).status,
    ).toBe(200)
  })

  it('sells part of a quantity: splits the row, prorates basis, books the gain', async () => {
    const res = await api.call('POST', `/items/${ownedCardId}/sell`, {
      date: '2026-11-23',
      quantity: 1,
      proceedsCents: 2500,
      toAccountId: acct.Checking,
    })
    expect(res.status).toBe(200)
    const sold = res.body
    expect(sold.id).not.toBe(ownedCardId)
    expect(sold).toMatchObject({
      quantity: 1,
      costBasisCents: 1000,
      saleProceedsCents: 2500,
      soldDate: '2026-11-23',
    })
    const kept = (await api.call('GET', `/items/${ownedCardId}`)).body
    expect(kept).toMatchObject({
      quantity: 2,
      costBasisCents: 2000,
      soldDate: null,
    })
    expect(await balance('realized_gains')).toBe(-1500) // a $15 gain (credit)
    expect((await check()).ok).toBe(true)

    // The kept part shares the original opening entry, so its cost is now fixed.
    const locked = await api.call('PATCH', `/items/${ownedCardId}`, {
      costBasisCents: 1,
    })
    expect(locked.status).toBe(409)
  })

  it('gives an item away ($0 sale, no account) and requires an account when there are proceeds', async () => {
    const added = await api.call('POST', '/items', {
      kind: 'card',
      name: 'Spare common',
      card: { ...card, productId: 7777 },
      acquisition: { mode: 'baseline', date: '2026-11-20', valueCents: 50 },
    })
    const noAccount = await api.call('POST', `/items/${added.body.id}/sell`, {
      date: '2026-11-24',
      quantity: 1,
      proceedsCents: 100,
    })
    expect(noAccount.status).toBe(400)
    const gainsBefore = await balance('realized_gains')
    const giveaway = await api.call('POST', `/items/${added.body.id}/sell`, {
      date: '2026-11-24',
      quantity: 1,
      proceedsCents: 0,
    })
    expect(giveaway.status).toBe(200)
    expect(giveaway.body.soldDate).toBe('2026-11-24')
    expect(await balance('realized_gains')).toBe(gainsBefore + 50) // a $0.50 loss
    expect((await check()).ok).toBe(true)
  })

  it('sells at a loss, and undoing the sale restores everything', async () => {
    const gainsBefore = await balance('realized_gains')
    const res = await api.call('POST', `/items/${boughtBoxId}/sell`, {
      date: '2026-11-24',
      quantity: 1,
      proceedsCents: 18000,
      toAccountId: acct.Checking,
    })
    expect(await balance('realized_gains')).toBe(gainsBefore + 3000) // $30 loss (debit)
    expect(await balance('collection_sealed')).toBe(0)
    expect((await check()).ok).toBe(true)

    const sold = await api.call('GET', '/items?status=sold')
    expect(sold.body.map((i: any) => i.id)).toContain(boughtBoxId)

    await api.call('DELETE', `/items/${res.body.id}/sale`)
    expect(await balance('realized_gains')).toBe(gainsBefore)
    expect(await balance('collection_sealed')).toBe(21000)
    expect((await check()).ok).toBe(true)
  })

  it('deletes an unsold item together with its acquisition entry', async () => {
    const checkingBefore = await balance('Checking')
    const item = (await api.call('GET', `/items/${boughtBoxId}`)).body
    expect((await api.call('DELETE', `/items/${boughtBoxId}`)).status).toBe(200)
    expect(
      (await api.call('GET', `/transactions/${item.acquiredTxnId}`)).status,
    ).toBe(404)
    expect(await balance('Checking')).toBe(checkingBefore + 21000)
    expect((await check()).ok).toBe(true)
  })

  it('lists owned items with value info, filtered by kind and search', async () => {
    const all = await api.call('GET', '/items')
    expect(all.body.every((i: any) => i.soldDate === null)).toBe(true)
    const cards = await api.call('GET', '/items?kind=card&q=luffy')
    expect(cards.body).toHaveLength(1)
    expect(cards.body[0]).toMatchObject({ quantity: 2, unitPriceCents: 1000 })
  })
})

describe('dashboard', () => {
  it('keeps the collection out of cash but inside net worth', async () => {
    const res = await api.call('GET', '/dashboard?today=2026-11-24')
    const collection = await balance('collection')
    const subtree = (await check()).ledgerCents
    expect(res.body.collectionCostCents).toBe(subtree)
    expect(collection).toBe(0) // the parent holds nothing itself; its children do
    expect(res.body.cashCents + res.body.collectionCostCents).toBe(
      res.body.bookNetWorthCents - (await balance('Credit Card')),
    )
  })
})
