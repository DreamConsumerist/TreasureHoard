// The card search index build (lib/pricing/catalog.ts), against PGlite with a
// fake TCGCSV.

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { catalogGroups, catalogProducts, syncRuns } from '../../db/schema.ts'
import type { Db } from '../../db/types.ts'
import { CATALOG_PAUSE_MS } from '../../lib/pricing/catalog.ts'
import { runSync } from '../../lib/pricing/sync.ts'
import { createTestApi } from '../api/harness.ts'

const BASE = 'https://tcgcsv.com/tcgplayer'
let mtgGroups = [
  {
    groupId: 2098,
    name: 'Rivals of Ixalan',
    abbreviation: 'RIX',
    publishedOn: '2018-01-19T00:00:00',
    modifiedOn: '2025-01-01T00:00:00',
  },
  {
    groupId: 2576,
    name: 'Secret Lair Drop Series',
    abbreviation: 'SLD',
    publishedOn: '2019-12-02T00:00:00',
    modifiedOn: '2025-01-01T00:00:00',
  },
  {
    groupId: 9999,
    name: 'Broken Set',
    abbreviation: '',
    publishedOn: '2020-01-01T00:00:00',
    modifiedOn: '2025-01-01T00:00:00',
  },
]
const products: Record<number, unknown[]> = {
  2098: [
    {
      productId: 155562,
      name: 'Ghalta, Primal Hunger',
      imageUrl: 'https://img/155562.jpg',
      extendedData: [
        { name: 'Number', value: '130' },
        { name: 'Rarity', value: 'R' },
      ],
    },
    { productId: 155000, name: 'Rivals of Ixalan Booster Box' },
  ],
  2576: [
    {
      productId: 456625,
      name: 'Ghalta, Primal Hunger',
      extendedData: [
        { name: 'Number', value: '1124' },
        { name: 'Rarity', value: 'M' },
      ],
    },
  ],
}

const fetched: string[] = []
const agents: (string | null)[] = []
const fakeFetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url = String(input)
  fetched.push(url)
  agents.push(new Headers(init?.headers).get('User-Agent'))
  const json = (results: unknown[]) =>
    new Response(JSON.stringify({ success: true, results }))
  if (url === `${BASE}/1/groups`) return json(mtgGroups)
  if (url === `${BASE}/68/groups` || url === `${BASE}/89/groups`)
    return json([])
  const m = /\/1\/(\d+)\/products$/.exec(url)
  if (m && products[Number(m[1])]) return json(products[Number(m[1])]!)
  return new Response('nope', { status: 500 })
}) as typeof fetch

let api: Awaited<ReturnType<typeof createTestApi>>
let db: Db
const sleeps: number[] = []
const options = {
  sleep: async (ms: number) => {
    sleeps.push(ms)
  },
}

beforeAll(async () => {
  api = await createTestApi()
  db = api.db as unknown as Db
})
afterAll(() => api.close())

describe('building the card search index', () => {
  it('indexes every set, pausing between files, and keeps going past a broken one', async () => {
    const started = await runSync(db, fakeFetch, 'catalog', 'manual', options)
    if (!('runId' in started)) throw new Error(started.blocked)
    expect(agents.every((a) => a === agents[0])).toBe(true)
    // Three sets; the broken one is retried once (TCGCSV client retry).
    expect(new Set(fetched.filter((u) => u.endsWith('/products'))).size).toBe(3)
    expect(sleeps).toEqual([CATALOG_PAUSE_MS, CATALOG_PAUSE_MS])

    const rows = await db
      .select()
      .from(catalogProducts)
      .orderBy(catalogProducts.productId)
    expect(
      rows.map((r) => [r.productId, r.groupId, r.number, r.sealed]),
    ).toEqual([
      [155000, 2098, null, true],
      [155562, 2098, '130', false],
      [456625, 2576, '1124', false],
    ])
    const [run] = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.id, started.runId))
    expect(run).toMatchObject({ status: 'partial', okCount: 2, failedCount: 1 })
    expect(run!.error).toContain('Broken Set')

    const broken = await db
      .select()
      .from(catalogGroups)
      .where(eq(catalogGroups.groupId, 9999))
    expect(broken[0]).toMatchObject({
      productsSyncedAt: null,
      abbreviation: null,
    })
  })

  it('on refresh, fetches only new, changed and previously failed sets', async () => {
    fetched.length = 0
    mtgGroups = [
      ...mtgGroups.map((g) =>
        g.groupId === 2576 ? { ...g, modifiedOn: '2026-11-20T00:00:00' } : g,
      ),
      {
        groupId: 24000,
        name: 'Brand New Set',
        abbreviation: 'BNS',
        publishedOn: '2026-11-21T00:00:00',
        modifiedOn: '2026-11-21T00:00:00',
      },
    ]
    products[24000] = [
      {
        productId: 600001,
        name: 'New Card',
        extendedData: [{ name: 'Number', value: '1' }],
      },
    ]
    products[2576] = [] // the Secret Lair entry was removed upstream
    await runSync(db, fakeFetch, 'catalog', 'manual', options)
    expect(
      [
        ...new Set(
          fetched
            .filter((u) => u.endsWith('/products'))
            .map((u) => Number(/\/1\/(\d+)\//.exec(u)![1])),
        ),
      ].sort((a, b) => a - b),
    ).toEqual([2576, 9999, 24000])
    const ids = (
      await db.select({ id: catalogProducts.productId }).from(catalogProducts)
    )
      .map((r) => r.id)
      .sort()
    expect(ids).toEqual([155000, 155562, 600001])
  })
})
