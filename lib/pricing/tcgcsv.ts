// TCGCSV client: TCGplayer's catalog and prices, republished daily as JSON
// at tcgcsv.com. Used for cards and sealed product.
//
//   /tcgplayer/{categoryId}/groups               sets
//   /tcgplayer/{categoryId}/{groupId}/products   products in a set (~870 KB for a big MTG set)
//   /tcgplayer/{categoryId}/{groupId}/prices     one row per product + sub-type (Normal, Foil)
//
// Responses are trimmed to what the app needs (~10% of the raw size).
// Requests go one at a time with a single retry: rapid back-to-back requests
// have come back empty, which looks like light rate limiting.

import { parseMoney } from '../ledger/money.ts'
import { SOURCE_HEADERS } from './http.ts'

export const GAMES = {
  mtg: { categoryId: 1, label: 'Magic: The Gathering' },
  onepiece: { categoryId: 68, label: 'One Piece' },
  riftbound: { categoryId: 89, label: 'Riftbound' },
} as const
export type Game = keyof typeof GAMES

const BASE = 'https://tcgcsv.com/tcgplayer'
const RETRY_DELAY_MS = 1500

export interface TcgGroup {
  groupId: number
  name: string
  abbreviation: string | null
  publishedOn: string // 'YYYY-MM-DD'
}

export interface TcgPrice {
  subType: string
  marketCents: number | null
  lowCents: number | null
}

export interface TcgProduct {
  productId: number
  name: string
  number: string | null
  rarity: string | null
  imageUrl: string | null
  /** No card number or rarity: a booster box, bundle, deck, etc. */
  sealed: boolean
  prices: TcgPrice[]
}

/** Dollars (a float like 256.03) → integer cents, via the string so floats never leak in. */
export function dollarsToCents(
  dollars: number | null | undefined,
): number | null {
  if (dollars === null || dollars === undefined || !Number.isFinite(dollars))
    return null
  return parseMoney(dollars.toFixed(2))
}

async function getResults(
  fetchFn: typeof fetch,
  url: string,
): Promise<unknown[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      // TCGCSV 401s requests without an identifying User-Agent.
      const res = await fetchFn(url, { headers: SOURCE_HEADERS })
      if (res.ok) {
        const body = (await res.json()) as {
          success?: boolean
          results?: unknown[]
        }
        if (Array.isArray(body.results)) return body.results
      }
      if (attempt >= 2)
        throw new Error(`TCGCSV returned ${res.status} for ${url}`)
    } catch (err) {
      if (attempt >= 2) throw err
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
  }
}

/** A game's sets, newest first, excluding sets not yet released as of `today`. */
export async function fetchGroups(
  fetchFn: typeof fetch,
  categoryId: number,
  today: string,
): Promise<TcgGroup[]> {
  const rows = (await getResults(fetchFn, `${BASE}/${categoryId}/groups`)) as {
    groupId: number
    name: string
    abbreviation?: string | null
    publishedOn?: string
  }[]
  return rows
    .map((g) => ({
      groupId: g.groupId,
      name: g.name,
      abbreviation: g.abbreviation ?? null,
      publishedOn: (g.publishedOn ?? '').slice(0, 10),
    }))
    .filter((g) => g.publishedOn !== '' && g.publishedOn <= today)
    .sort(
      (a, b) =>
        b.publishedOn.localeCompare(a.publishedOn) ||
        a.name.localeCompare(b.name),
    )
}

interface RawProduct {
  productId: number
  name: string
  imageUrl?: string | null
  extendedData?: { name: string; value: string }[]
}
interface RawPrice {
  productId: number
  subTypeName: string
  marketPrice: number | null
  lowPrice: number | null
}

/** Merges a set's raw products and prices into trimmed rows, sorted by name. */
export function mergeCatalog(
  products: RawProduct[],
  prices: RawPrice[],
): TcgProduct[] {
  const pricesByProduct = new Map<number, TcgPrice[]>()
  for (const p of prices) {
    const list = pricesByProduct.get(p.productId) ?? []
    list.push({
      subType: p.subTypeName,
      marketCents: dollarsToCents(p.marketPrice),
      lowCents: dollarsToCents(p.lowPrice),
    })
    pricesByProduct.set(p.productId, list)
  }
  return products
    .map((p) => {
      const ext = (name: string) =>
        p.extendedData?.find((e) => e.name === name)?.value ?? null
      const number = ext('Number')
      const rarity = ext('Rarity')
      return {
        productId: p.productId,
        name: p.name,
        number,
        rarity,
        imageUrl: p.imageUrl ?? null,
        sealed: number === null && rarity === null,
        prices: (pricesByProduct.get(p.productId) ?? []).sort((a, b) =>
          a.subType.localeCompare(b.subType),
        ),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** One set's products with their current prices. Two requests, made one after the other. */
export async function fetchSetCatalog(
  fetchFn: typeof fetch,
  categoryId: number,
  groupId: number,
): Promise<TcgProduct[]> {
  const products = (await getResults(
    fetchFn,
    `${BASE}/${categoryId}/${groupId}/products`,
  )) as RawProduct[]
  const prices = (await getResults(
    fetchFn,
    `${BASE}/${categoryId}/${groupId}/prices`,
  )) as RawPrice[]
  return mergeCatalog(products, prices)
}

export interface TcgPriceRow {
  productId: number
  subType: string
  marketCents: number | null
}

/** Just a set's prices (no product list): what the daily sync needs. One request. */
export async function fetchSetPrices(
  fetchFn: typeof fetch,
  categoryId: number,
  groupId: number,
): Promise<TcgPriceRow[]> {
  const prices = (await getResults(
    fetchFn,
    `${BASE}/${categoryId}/${groupId}/prices`,
  )) as RawPrice[]
  return prices.map((p) => ({
    productId: p.productId,
    subType: p.subTypeName,
    marketCents: dollarsToCents(p.marketPrice),
  }))
}

// --- For the card search index (lib/pricing/catalog.ts) ---------------------

export interface TcgCatalogGroup {
  groupId: number
  name: string
  abbreviation: string | null
  publishedOn: string | null // 'YYYY-MM-DD'
  /** Changes whenever TCGplayer edits the set's products. */
  modifiedOn: string | null
}

/** Every set of a game, released or not, with its last-modified stamp. */
export async function fetchCatalogGroups(
  fetchFn: typeof fetch,
  categoryId: number,
): Promise<TcgCatalogGroup[]> {
  const rows = (await getResults(fetchFn, `${BASE}/${categoryId}/groups`)) as {
    groupId: number
    name: string
    abbreviation?: string | null
    publishedOn?: string | null
    modifiedOn?: string | null
  }[]
  return rows.map((g) => ({
    groupId: g.groupId,
    name: g.name,
    abbreviation: g.abbreviation || null,
    publishedOn: g.publishedOn ? g.publishedOn.slice(0, 10) : null,
    modifiedOn: g.modifiedOn ?? null,
  }))
}

/** A set's products without prices. One request. */
export async function fetchSetProducts(
  fetchFn: typeof fetch,
  categoryId: number,
  groupId: number,
): Promise<Omit<TcgProduct, 'prices'>[]> {
  const products = (await getResults(
    fetchFn,
    `${BASE}/${categoryId}/${groupId}/products`,
  )) as RawProduct[]
  return mergeCatalog(products, []).map((p) => ({
    productId: p.productId,
    name: p.name,
    number: p.number,
    rarity: p.rarity,
    imageUrl: p.imageUrl,
    sealed: p.sealed,
  }))
}
