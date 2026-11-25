// /api/catalog: product lookup for the "add item" form. The browser can't call
// TCGCSV or PriceCharting itself (no CORS), so these routes fetch on its behalf.
//
// TCGCSV publishes once a day, so set lists and set catalogs are cached in
// this function instance's memory for an hour, and the browser is told it may
// cache them too. PriceCharting lookups are never cached: each one is a single
// fetch made because you pasted a URL and pressed Look up.

import { Hono } from 'hono'
import { z } from 'zod'
import { GAME_KEYS } from '../../collection/schemas.ts'
import type { PriceChartingLookupOut } from '../../collection/types.ts'
import {
  fetchPriceChartingPage,
  normalizePriceChartingUrl,
  platformLabel,
} from '../../pricing/pricecharting.ts'
import { fetchGroups, fetchSetCatalog, GAMES } from '../../pricing/tcgcsv.ts'
import { fail, validate } from '../errors.ts'
import { todayUtc } from '../ledger/accounts.ts'

const CACHE_MS = 60 * 60 * 1000

/** A tiny time-limited memo, per function instance. */
function memo<T>() {
  const store = new Map<string, { at: number; value: Promise<T> }>()
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = store.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
    const value = load()
    store.set(key, { at: Date.now(), value })
    value.catch(() => store.delete(key)) // never cache a failure
    return value
  }
}

export function catalogRoutes(fetchFn: typeof fetch) {
  const r = new Hono()
  const groupsCache = memo<Awaited<ReturnType<typeof fetchGroups>>>()
  const catalogCache = memo<Awaited<ReturnType<typeof fetchSetCatalog>>>()

  const upstream = async <T>(
    what: string,
    load: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await load()
    } catch (err) {
      console.error(`${what} failed:`, err)
      fail(502, `${what} is unavailable right now. Try again in a minute.`)
    }
  }

  r.get(
    '/tcg/groups',
    validate('query', z.object({ game: z.enum(GAME_KEYS) })),
    async (c) => {
      const { game } = c.req.valid('query')
      const { categoryId } = GAMES[game]
      const groups = await upstream('TCGCSV', () =>
        groupsCache(String(categoryId), () =>
          fetchGroups(fetchFn, categoryId, todayUtc()),
        ),
      )
      c.header('Cache-Control', 'private, max-age=86400')
      return c.json(groups)
    },
  )

  r.get(
    '/tcg/products',
    validate(
      'query',
      z.object({
        game: z.enum(GAME_KEYS),
        groupId: z.coerce.number().pipe(z.int().positive()),
      }),
    ),
    async (c) => {
      const { game, groupId } = c.req.valid('query')
      const { categoryId } = GAMES[game]
      const products = await upstream('TCGCSV', () =>
        catalogCache(`${categoryId}/${groupId}`, () =>
          fetchSetCatalog(fetchFn, categoryId, groupId),
        ),
      )
      c.header('Cache-Control', 'private, max-age=3600')
      return c.json(products)
    },
  )

  r.post(
    '/pricecharting',
    validate('json', z.object({ url: z.string().max(500) })),
    async (c) => {
      const parsed = normalizePriceChartingUrl(c.req.valid('json').url)
      if (!parsed) {
        fail(
          400,
          'Paste a PriceCharting product link, like https://www.pricecharting.com/game/…',
        )
      }
      const page = await upstream('PriceCharting', () =>
        fetchPriceChartingPage(fetchFn, parsed.url),
      )
      const out: PriceChartingLookupOut = {
        url: parsed.url,
        path: parsed.path,
        name: page.name,
        platform: platformLabel(parsed.platform),
        prices: page.prices,
        imageUrl: page.imageUrl,
      }
      return c.json(out)
    },
  )

  return r
}
