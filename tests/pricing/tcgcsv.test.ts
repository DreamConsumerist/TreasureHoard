import { describe, expect, it } from 'vitest'
import {
  dollarsToCents,
  fetchGroups,
  fetchSetCatalog,
  mergeCatalog,
} from '../../lib/pricing/tcgcsv.ts'
import { USER_AGENT } from '../../lib/pricing/http.ts'

// Shapes copied from real TCGCSV responses (Riftbound, 2026-11-24), trimmed.
const products = [
  {
    productId: 732651,
    name: 'Ahri, Nine-Tailed Fox',
    imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/732651_200w.jpg',
    extendedData: [
      { name: 'Rarity', value: 'Epic' },
      { name: 'Number', value: '001' },
    ],
  },
  {
    productId: 732649,
    name: 'Riftbound x K/DA: Couture Collection (Sealed Promotional Bundle)',
    imageUrl: null,
    extendedData: [],
  },
]
const prices = [
  {
    productId: 732649,
    lowPrice: 230.0,
    marketPrice: 256.03,
    subTypeName: 'Normal',
  },
  {
    productId: 732651,
    lowPrice: 0.1,
    marketPrice: 19.89,
    subTypeName: 'Normal',
  },
  { productId: 732651, lowPrice: null, marketPrice: null, subTypeName: 'Foil' },
]

const ok = (results: unknown[]) =>
  new Response(JSON.stringify({ success: true, results }))

describe('dollarsToCents', () => {
  it('converts exactly, never through float multiplication', () => {
    expect(dollarsToCents(19.89)).toBe(1989)
    expect(dollarsToCents(0.1)).toBe(10)
    expect(dollarsToCents(256.03)).toBe(25603)
    expect(dollarsToCents(1.15)).toBe(115)
    expect(dollarsToCents(null)).toBeNull()
    expect(dollarsToCents(Number.NaN)).toBeNull()
  })
})

describe('mergeCatalog', () => {
  it('trims products, attaches prices per sub-type and flags sealed product', () => {
    const merged = mergeCatalog(products, prices)
    expect(merged.map((p) => p.productId)).toEqual([732651, 732649]) // sorted by name
    expect(merged[0]).toEqual({
      productId: 732651,
      name: 'Ahri, Nine-Tailed Fox',
      number: '001',
      rarity: 'Epic',
      imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/732651_200w.jpg',
      sealed: false,
      prices: [
        { subType: 'Foil', marketCents: null, lowCents: null },
        { subType: 'Normal', marketCents: 1989, lowCents: 10 },
      ],
    })
    expect(merged[1]!.sealed).toBe(true)
    expect(merged[1]!.prices).toEqual([
      { subType: 'Normal', marketCents: 25603, lowCents: 23000 },
    ])
  })
})

describe('fetching', () => {
  it('drops unreleased sets and sorts newest first', async () => {
    const fakeFetch = (async () =>
      ok([
        {
          groupId: 1,
          name: 'Old',
          abbreviation: 'OLD',
          publishedOn: '2025-01-10T00:00:00',
        },
        {
          groupId: 2,
          name: 'Future',
          abbreviation: 'FUT',
          publishedOn: '2027-01-29T00:00:00',
        },
        {
          groupId: 3,
          name: 'New',
          abbreviation: null,
          publishedOn: '2026-11-11T00:00:00',
        },
      ])) as unknown as typeof fetch
    const groups = await fetchGroups(fakeFetch, 89, '2026-11-24')
    expect(groups.map((g) => g.name)).toEqual(['New', 'Old'])
    expect(groups[0]!.publishedOn).toBe('2026-11-11')
  })

  it('fetches products then prices one after the other, retrying an empty response once', async () => {
    const calls: string[] = []
    let emptyOnce = true
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      if (url.endsWith('/prices') && emptyOnce) {
        emptyOnce = false
        return new Response('') // what a rate-limited response looked like
      }
      return ok(url.endsWith('/products') ? products : prices)
    }) as unknown as typeof fetch
    const catalog = await fetchSetCatalog(fakeFetch, 89, 24943)
    expect(catalog).toHaveLength(2)
    expect(calls).toEqual([
      'https://tcgcsv.com/tcgplayer/89/24943/products',
      'https://tcgcsv.com/tcgplayer/89/24943/prices',
      'https://tcgcsv.com/tcgplayer/89/24943/prices',
    ])
  }, 10_000)

  it('identifies the app in the User-Agent (TCGCSV 401s the default one)', async () => {
    const agents: (string | null)[] = []
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      agents.push(new Headers(init?.headers).get('User-Agent'))
      return ok([])
    }) as unknown as typeof fetch
    await fetchGroups(fakeFetch, 68, '2026-11-24')
    expect(agents).toEqual([USER_AGENT])
  })

  it('gives up after the retry', async () => {
    const fakeFetch = (async () =>
      new Response('', { status: 503 })) as unknown as typeof fetch
    await expect(fetchGroups(fakeFetch, 1, '2026-11-24')).rejects.toThrow('503')
  }, 10_000)
})
