// /api/catalog: product lookup for the "add item" form. The browser can't call
// TCGCSV or PriceCharting itself (no CORS), so these routes fetch on its behalf.
//
// TCGCSV publishes once a day, so set lists and set catalogs are cached in
// this function instance's memory for an hour, and the browser is told it may
// cache them too. PriceCharting lookups are never cached: each one is a single
// fetch made because you pasted a URL and pressed Look up.

import { and, desc, eq, ilike, isNotNull, sql, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { catalogGroups, catalogProducts } from '../../../db/schema.ts'
import type { Db } from '../../../db/types.ts'
import { GAME_KEYS } from '../../collection/schemas.ts'
import type {
  CatalogHit,
  CatalogSearchOut,
  PriceChartingLookupOut,
} from '../../collection/types.ts'
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

const SEARCH_LIMIT = 60
/** Escapes LIKE wildcards so a search for "50%" matches literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`)

/**
 * Name search over the card search index (lib/pricing/catalog.ts). Every word
 * must appear in the name, in any order. Ranking: exact name, then names
 * starting with the query, then newest set first.
 */
export async function searchCatalog(
  db: Db,
  opts: {
    categoryId: number
    q: string
    sealed?: boolean
    groupId?: number
    limit?: number
  },
): Promise<CatalogSearchOut> {
  const [built] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(catalogGroups)
    .where(
      and(
        eq(catalogGroups.categoryId, opts.categoryId),
        isNotNull(catalogGroups.productsSyncedAt),
      ),
    )
  if (!built?.n) return { indexed: false, results: [] }

  const words = opts.q.split(/\s+/).filter(Boolean)
  const where: SQL[] = [eq(catalogProducts.categoryId, opts.categoryId)]
  for (const w of words)
    where.push(ilike(catalogProducts.name, `%${likeEscape(w)}%`))
  if (opts.sealed !== undefined)
    where.push(eq(catalogProducts.sealed, opts.sealed))
  if (opts.groupId) where.push(eq(catalogProducts.groupId, opts.groupId))

  const q = opts.q.trim().toLowerCase()
  const rows = await db
    .select({
      productId: catalogProducts.productId,
      groupId: catalogProducts.groupId,
      setName: catalogGroups.name,
      setCode: catalogGroups.abbreviation,
      publishedOn: catalogGroups.publishedOn,
      name: catalogProducts.name,
      number: catalogProducts.number,
      rarity: catalogProducts.rarity,
      imageUrl: catalogProducts.imageUrl,
      sealed: catalogProducts.sealed,
    })
    .from(catalogProducts)
    .innerJoin(
      catalogGroups,
      eq(catalogGroups.groupId, catalogProducts.groupId),
    )
    .where(and(...where))
    .orderBy(
      desc(sql`lower(${catalogProducts.name}) = ${q}`),
      desc(sql`lower(${catalogProducts.name}) like ${`${likeEscape(q)}%`}`),
      sql`${catalogGroups.publishedOn} desc nulls last`,
      catalogProducts.name,
      catalogProducts.productId,
    )
    .limit(opts.limit ?? SEARCH_LIMIT)
  return { indexed: true, results: rows satisfies CatalogHit[] }
}

export function catalogRoutes(db: Db, fetchFn: typeof fetch) {
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

  // GET /api/catalog/tcg/search?game=mtg&q=ghalta[&sealed=false][&groupId=…]
  r.get(
    '/tcg/search',
    validate(
      'query',
      z.object({
        game: z.enum(GAME_KEYS),
        q: z.string().trim().min(2).max(100),
        sealed: z.enum(['true', 'false']).optional(),
        groupId: z.coerce.number().pipe(z.int().positive()).optional(),
      }),
    ),
    async (c) => {
      const { game, q, sealed, groupId } = c.req.valid('query')
      return c.json(
        await searchCatalog(db, {
          categoryId: GAMES[game].categoryId,
          q,
          sealed: sealed === undefined ? undefined : sealed === 'true',
          groupId,
        }),
      )
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
