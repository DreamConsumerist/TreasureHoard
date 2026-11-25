// /api/prices (sync status, Refresh now) and the market-value fields on
// /api/items and /api/dashboard.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../../db/types.ts'
import { executeRun } from '../../lib/pricing/sync.ts'
import { recordSnapshot } from '../../lib/pricing/snapshots.ts'
import { deriveSyncKey, SYNC_KEY_HEADER } from '../../lib/pricing/syncKey.ts'
import { createTestApi } from './harness.ts'

const card = {
  kind: 'card',
  name: 'Shanks',
  quantity: 2,
  card: {
    categoryId: 68,
    groupId: 100,
    productId: 5555,
    subType: 'Normal',
    setName: 'Romance Dawn',
  },
  acquisition: { mode: 'baseline', date: '2026-11-01', valueCents: 3000 },
  observedPrice: { priceCents: 1500, asOf: '2026-11-01' },
}

describe('price sync API', () => {
  let api: Awaited<ReturnType<typeof createTestApi>>
  let backgroundStatus = 202
  const calls: { url: string; init?: RequestInit }[] = []

  beforeAll(async () => {
    api = await createTestApi({
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        return new Response(null, { status: backgroundStatus })
      }) as typeof fetch,
    })
  })
  afterAll(() => api.close())

  const status = async () =>
    Object.fromEntries(
      ((await api.call<any[]>('GET', '/prices/status')).body as any[]).map(
        (s) => [s.job, s],
      ),
    )

  it('reports nothing to sync and nothing stale before anything is owned', async () => {
    const s = await status()
    expect(s.tcg).toMatchObject({
      hasTargets: false,
      last: null,
      lastSuccessAt: null,
      stale: false,
    })
    expect(s.games.hasTargets).toBe(false)
  })

  it('flags card prices as stale once a card is owned and never synced', async () => {
    await api.call('POST', '/items', card)
    const s = await status()
    expect(s.tcg).toMatchObject({ hasTargets: true, stale: true })
    expect(s.games).toMatchObject({ hasTargets: false, stale: false })
  })

  it('records the run and hands it to the background function with the key', async () => {
    const res = await api.call('POST', '/prices/sync', { job: 'tcg' })
    expect(res.status).toBe(202)
    const runId = res.body.runId
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(
      'http://localhost/.netlify/functions/price-sync-background',
    )
    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.get(SYNC_KEY_HEADER)).toBe(
      await deriveSyncKey(process.env.SESSION_SECRET!),
    )
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      runIds: [runId],
    })
    expect((await status()).tcg.last).toMatchObject({
      id: runId,
      status: 'running',
      trigger: 'manual',
    })

    // A second click while it runs is refused.
    const again = await api.call('POST', '/prices/sync', { job: 'tcg' })
    expect(again.status).toBe(409)

    // The background function does the work; afterwards nothing is stale.
    const tcgFetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          results: [
            {
              productId: 5555,
              subTypeName: 'Normal',
              marketPrice: 20,
              lowPrice: 18,
            },
          ],
        }),
      )) as unknown as typeof fetch
    await executeRun(api.db as unknown as Db, tcgFetch, runId)
    const s = await status()
    expect(s.tcg.last).toMatchObject({ status: 'ok', okCount: 1 })
    expect(s.tcg.stale).toBe(false)
  })

  it('marks the run failed when the background function won’t start', async () => {
    backgroundStatus = 500
    const res = await api.call('POST', '/prices/sync', { job: 'tcg' })
    expect(res.status).toBe(502)
    expect((await status()).tcg.last).toMatchObject({ status: 'failed' })
    expect((await status()).tcg.last.error).toContain('500')
    backgroundStatus = 202
  })

  it('rejects an unknown job', async () => {
    expect(
      (await api.call('POST', '/prices/sync', { job: 'stocks' })).status,
    ).toBe(400)
  })
})

describe('market value', () => {
  let api: Awaited<ReturnType<typeof createTestApi>>
  let cardId: number

  beforeAll(async () => {
    api = await createTestApi()
    cardId = (await api.call('POST', '/items', card)).body.id
    // A later price, 9 days on: the 11-01 price is its week-ago price.
    await recordSnapshot(
      api.db as unknown as Db,
      { source: 'tcgcsv', externalId: '5555', variant: 'Normal' },
      2000,
      '2026-11-10',
      true,
    )
    // An unlisted item with no price at all: counts at cost.
    await api.call('POST', '/items', {
      kind: 'hardware',
      name: 'Collector 3DS',
      game: { platform: 'Nintendo 3DS', url: null, variant: 'cib' },
      acquisition: { mode: 'baseline', date: '2026-11-01', valueCents: 500 },
    })
  })
  afterAll(() => api.close())

  it('gives each item its week-ago price', async () => {
    const item = (await api.call('GET', `/items/${cardId}`)).body
    expect(item).toMatchObject({
      unitPriceCents: 2000,
      priceAsOf: '2026-11-10',
      weekAgoPriceCents: 1500,
    })
  })

  it('has no week-ago price when history is shorter than a week', async () => {
    await recordSnapshot(
      api.db as unknown as Db,
      { source: 'tcgcsv', externalId: '5555', variant: 'Normal' },
      2100,
      '2026-11-12',
      true,
    )
    // 11-12 minus 7 days is 11-05: the latest price on or before that is still 11-01.
    expect(
      (await api.call('GET', `/items/${cardId}`)).body.weekAgoPriceCents,
    ).toBe(1500)
    const list = await api.call<any[]>(
      'GET',
      '/items?status=owned&kind=hardware',
    )
    expect(list.body[0].weekAgoPriceCents).toBeNull()
  })

  it('puts market value, market net worth and movers on the dashboard', async () => {
    const d = (await api.call('GET', '/dashboard?today=2026-11-12')).body
    // Card: 2 × $21.00 = $42.00. 3DS unpriced, at its $5.00 cost.
    expect(d.collectionCostCents).toBe(3500)
    expect(d.collectionMarketCents).toBe(4200 + 500)
    expect(d.marketNetWorthCents).toBe(d.bookNetWorthCents - 3500 + 4700)
    expect(d.movers).toEqual([
      {
        itemId: cardId,
        name: 'Shanks',
        imageUrl: null,
        quantity: 2,
        valueCents: 4200,
        changeCents: (2100 - 1500) * 2,
      },
    ])
  })
})
