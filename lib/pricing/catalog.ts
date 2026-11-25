// The card search index: a copy of TCGCSV's sets and products for the games
// the app covers, so a card can be found by name without knowing its set.
//
// TCGCSV has no search, only one product file per set (459 sets for Magic).
// The first build fetches every set, one request every PAGE_PAUSE_MS. Later
// runs fetch only sets that are new or whose `modifiedOn` changed, so a
// weekly refresh is a handful of requests. Runs as the `catalog` sync job
// (lib/pricing/sync.ts), in the background function.
//
// Each set is replaced in one database transaction, so a search never sees a
// half-indexed set, and one failing set doesn't stop the rest.

import { eq, sql } from 'drizzle-orm'
import { catalogGroups, catalogProducts } from '../../db/schema.ts'
import type { Db } from '../../db/types.ts'
import { fetchCatalogGroups, fetchSetProducts, GAMES } from './tcgcsv.ts'

/** Pause between product files: about 2 requests a second, gentle on TCGCSV. */
export const CATALOG_PAUSE_MS = 500
/** Rows per INSERT: well under Postgres's 65,535-parameter limit. */
const INSERT_CHUNK = 1000

export interface CatalogOutcome {
  ok: number
  failed: number
  errors: string[]
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

/** Indexes new and changed sets for every game. Counts are per set. */
export async function syncCatalog(
  db: Db,
  fetchFn: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  outcome: CatalogOutcome,
): Promise<void> {
  let first = true
  for (const { categoryId, label } of Object.values(GAMES)) {
    let groups
    try {
      groups = await fetchCatalogGroups(fetchFn, categoryId)
    } catch (err) {
      outcome.failed++
      outcome.errors.push(`${label} set list: ${message(err)}`)
      continue
    }

    const known = new Map(
      (
        await db
          .select({
            groupId: catalogGroups.groupId,
            modifiedOn: catalogGroups.modifiedOn,
            syncedAt: catalogGroups.productsSyncedAt,
          })
          .from(catalogGroups)
          .where(eq(catalogGroups.categoryId, categoryId))
      ).map((g) => [g.groupId, g]),
    )

    // Names and dates are kept current for every set. modified_on is only
    // written once a set's products are in, so a failed set is retried.
    for (let i = 0; i < groups.length; i += INSERT_CHUNK) {
      await db
        .insert(catalogGroups)
        .values(
          groups.slice(i, i + INSERT_CHUNK).map((g) => ({
            groupId: g.groupId,
            categoryId,
            name: g.name,
            abbreviation: g.abbreviation,
            publishedOn: g.publishedOn,
          })),
        )
        .onConflictDoUpdate({
          target: catalogGroups.groupId,
          set: {
            name: sql`excluded.name`,
            abbreviation: sql`excluded.abbreviation`,
            publishedOn: sql`excluded.published_on`,
          },
        })
    }

    const due = groups.filter((g) => {
      const k = known.get(g.groupId)
      return !k || !k.syncedAt || k.modifiedOn !== g.modifiedOn
    })
    for (const g of due) {
      if (!first) await sleep(CATALOG_PAUSE_MS)
      first = false
      try {
        const products = await fetchSetProducts(fetchFn, categoryId, g.groupId)
        await db.transaction(async (tx) => {
          await tx
            .delete(catalogProducts)
            .where(eq(catalogProducts.groupId, g.groupId))
          for (let i = 0; i < products.length; i += INSERT_CHUNK) {
            await tx
              .insert(catalogProducts)
              .values(
                products.slice(i, i + INSERT_CHUNK).map((p) => ({
                  productId: p.productId,
                  categoryId,
                  groupId: g.groupId,
                  name: p.name,
                  number: p.number,
                  rarity: p.rarity,
                  imageUrl: p.imageUrl,
                  sealed: p.sealed,
                })),
              )
              // A product listed under two sets keeps its latest home.
              .onConflictDoUpdate({
                target: catalogProducts.productId,
                set: {
                  groupId: sql`excluded.group_id`,
                  name: sql`excluded.name`,
                  number: sql`excluded.number`,
                  rarity: sql`excluded.rarity`,
                  imageUrl: sql`excluded.image_url`,
                  sealed: sql`excluded.sealed`,
                },
              })
          }
          await tx
            .update(catalogGroups)
            .set({ modifiedOn: g.modifiedOn, productsSyncedAt: new Date() })
            .where(eq(catalogGroups.groupId, g.groupId))
        })
        outcome.ok++
      } catch (err) {
        outcome.failed++
        outcome.errors.push(`${label}, ${g.name}: ${message(err)}`)
      }
    }
  }
}
