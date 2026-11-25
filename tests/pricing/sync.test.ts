// Price sync against PGlite (real migrations) with a fake fetch standing in
// for TCGCSV and PriceCharting.

import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gameDetails, priceSnapshots, syncRuns } from '../../db/schema.ts'
import type { Db } from '../../db/types.ts'
import { runSync, startBlocker } from '../../lib/pricing/sync.ts'
import { USER_AGENT } from '../../lib/pricing/http.ts'
import { createTestApi } from '../api/harness.ts'

const pcPage = readFileSync(
  'tests/fixtures/pricecharting/super-mario-world.html',
  'utf-8',
)
const SMW =
  'https://www.pricecharting.com/game/super-nintendo/super-mario-world'
const BROKEN = 'https://www.pricecharting.com/game/nintendo-3ds/broken-page'

let normalFoil = { normal: 1.5, foil: 3.25 }
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
  if (url === 'https://tcgcsv.com/tcgplayer/68/100/prices') {
    return json([
      {
        productId: 5555,
        subTypeName: 'Normal',
        marketPrice: normalFoil.normal,
        lowPrice: 1,
      },
      {
        productId: 5555,
        subTypeName: 'Foil',
        marketPrice: normalFoil.foil,
        lowPrice: 2,
      },
      {
        productId: 6666,
        subTypeName: 'Normal',
        marketPrice: null,
        lowPrice: null,
      },
      { productId: 9999, subTypeName: 'Normal', marketPrice: 10, lowPrice: 9 },
    ])
  }
  if (url === SMW) return new Response(pcPage)
  if (url === BROKEN)
    return new Response('<html><body>Page moved</body></html>')
  return new Response('unexpected', { status: 404 })
}) as typeof fetch

let api: Awaited<ReturnType<typeof createTestApi>>
let db: Db
const sleeps: number[] = []
const options = (today: string) => ({
  today,
  sleep: async (ms: number) => {
    sleeps.push(ms)
  },
})

const card = (productId: number, groupId = 100) => ({
  kind: 'card',
  name: `Card ${productId}`,
  card: {
    categoryId: 68,
    groupId,
    productId,
    subType: 'Normal',
    setName: `Set ${groupId}`,
  },
  acquisition: { mode: 'baseline', date: '2026-11-20', valueCents: 100 },
})
const game = (url: string, name: string) => ({
  kind: 'game',
  name,
  game: { platform: 'SNES', url, variant: 'cib' },
  acquisition: { mode: 'baseline', date: '2026-11-20', valueCents: 100 },
})

const snapshots = (source: 'tcgcsv' | 'pricecharting', externalId: string) =>
  db
    .select({
      variant: priceSnapshots.variant,
      priceCents: priceSnapshots.priceCents,
      asOf: priceSnapshots.asOf,
    })
    .from(priceSnapshots)
    .where(
      and(
        eq(priceSnapshots.source, source),
        eq(priceSnapshots.externalId, externalId),
      ),
    )
    .orderBy(priceSnapshots.asOf, priceSnapshots.variant)
const run = async (id: number) =>
  (await db.select().from(syncRuns).where(eq(syncRuns.id, id)))[0]!

beforeAll(async () => {
  api = await createTestApi()
  db = api.db as unknown as Db
  for (const body of [
    card(5555),
    card(5555), // a second copy: same set, fetched once
    card(6666),
    game(SMW, 'Super Mario World'),
    game(SMW, 'Super Mario World (spare)'),
    game(BROKEN, 'Broken'),
  ]) {
    expect((await api.call('POST', '/items', body)).status).toBe(201)
  }
  // A sold card from another set: its set must not be fetched.
  const sold = await api.call('POST', '/items', card(7777, 200))
  await api.call('POST', `/items/${sold.body.id}/sell`, {
    date: '2026-11-21',
    quantity: 1,
    proceedsCents: 0,
  })
})
afterAll(() => api.close())

describe('card and sealed prices (TCGCSV)', () => {
  it('fetches only owned sets and records every sub-type of owned products', async () => {
    fetched.length = 0
    const started = await runSync(
      db,
      fakeFetch,
      'tcg',
      'schedule',
      options('2026-11-30'),
    )
    if (!('runId' in started)) throw new Error(started.blocked)
    expect(fetched).toEqual(['https://tcgcsv.com/tcgplayer/68/100/prices'])
    expect(agents.at(-1)).toBe(USER_AGENT)

    expect(await snapshots('tcgcsv', '5555')).toEqual([
      { variant: 'Foil', priceCents: 325, asOf: '2026-11-30' },
      { variant: 'Normal', priceCents: 150, asOf: '2026-11-30' },
    ])
    expect(await snapshots('tcgcsv', '6666')).toEqual([]) // null price skipped
    expect(await snapshots('tcgcsv', '9999')).toEqual([]) // not owned
    expect(await run(started.runId)).toMatchObject({
      status: 'ok',
      okCount: 1,
      failedCount: 0,
      error: null,
    })
  })

  it('replaces the same day’s price on a re-run instead of duplicating it', async () => {
    normalFoil = { normal: 1.75, foil: 3.25 }
    await runSync(db, fakeFetch, 'tcg', 'manual', options('2026-11-30'))
    expect(await snapshots('tcgcsv', '5555')).toEqual([
      { variant: 'Foil', priceCents: 325, asOf: '2026-11-30' },
      { variant: 'Normal', priceCents: 175, asOf: '2026-11-30' },
    ])
  })

  it('shows the new price on the item', async () => {
    const list = await api.call<any[]>('GET', '/items?status=owned&kind=card')
    const item = list.body.find((i: any) => i.card.productId === 5555)
    expect(item).toMatchObject({ unitPriceCents: 175, priceAsOf: '2026-11-30' })
  })
})

describe('game and hardware prices (PriceCharting)', () => {
  let runId: number

  it('fetches each page once, pauses between pages, and records what it can', async () => {
    fetched.length = 0
    sleeps.length = 0
    const started = await runSync(
      db,
      fakeFetch,
      'games',
      'schedule',
      options('2026-11-30'),
    )
    if (!('runId' in started)) throw new Error(started.blocked)
    runId = started.runId
    expect([...fetched].sort()).toEqual([BROKEN, SMW])
    expect(sleeps).toEqual([3000])

    expect(
      await snapshots(
        'pricecharting',
        '/game/super-nintendo/super-mario-world',
      ),
    ).toEqual([
      { variant: 'cib', priceCents: 63503, asOf: '2026-11-30' },
      { variant: 'loose', priceCents: 1989, asOf: '2026-11-30' },
      { variant: 'new', priceCents: 188000, asOf: '2026-11-30' },
    ])
  })

  it('records a broken page as a failure, never as a $0 price', async () => {
    expect(
      await snapshots('pricecharting', '/game/nintendo-3ds/broken-page'),
    ).toEqual([])
    const r = await run(runId)
    expect(r).toMatchObject({ status: 'partial', okCount: 1, failedCount: 1 })
    expect(r.error).toContain('/game/nintendo-3ds/broken-page')
  })

  it('fills in missing cover photos', async () => {
    const rows = await db
      .select({ imageUrl: gameDetails.imageUrl })
      .from(gameDetails)
      .where(eq(gameDetails.pricechartingUrl, SMW))
    expect(rows).toHaveLength(2)
    for (const r of rows)
      expect(r.imageUrl).toMatch(/^https:\/\/storage\.googleapis\.com\//)
  })
})

describe('guards', () => {
  it('refuses a manual game refresh within an hour of the last one, but not a scheduled one', async () => {
    expect(await startBlocker(db, 'games', 'manual')).toMatch(
      /less than an hour/,
    )
    expect(await startBlocker(db, 'games', 'schedule')).toBeNull()
    expect(await startBlocker(db, 'tcg', 'manual')).toBeNull()
  })

  it('refuses to start while the same job is running, unless that run looks stuck', async () => {
    const [stuck] = await db
      .insert(syncRuns)
      .values({
        job: 'tcg',
        trigger: 'schedule',
        startedAt: new Date(Date.now() - 30 * 60_000),
      })
      .returning()
    expect(await startBlocker(db, 'tcg', 'manual')).toBeNull()

    await db.insert(syncRuns).values({ job: 'tcg', trigger: 'manual' })
    expect(await startBlocker(db, 'tcg', 'manual')).toMatch(/already running/)
    const blocked = await runSync(db, fakeFetch, 'tcg', 'manual')
    expect(blocked).toEqual({
      blocked: expect.stringMatching(/already running/),
    })
    expect(stuck).toBeDefined()
  })
})
