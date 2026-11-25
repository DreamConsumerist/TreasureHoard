// Reading and writing price snapshots (the price_snapshots table), shared by
// the item routes, the dashboard and the price sync.

import { desc, sql } from 'drizzle-orm'
import { priceSnapshots } from '../../db/schema.ts'
import type { Db, Tx } from '../../db/types.ts'
import { priceKeyString, type PriceKey } from '../collection/prices.ts'

/**
 * Records one price for one day. `overwrite` replaces a price already recorded
 * for that day (syncs and manual prices); without it the first price of the
 * day is kept (a lookup price seen while adding an item).
 */
export async function recordSnapshot(
  db: Db | Tx,
  key: PriceKey,
  priceCents: number,
  asOf: string,
  overwrite: boolean,
) {
  const insert = db.insert(priceSnapshots).values({ ...key, priceCents, asOf })
  if (overwrite) {
    await insert.onConflictDoUpdate({
      target: [
        priceSnapshots.source,
        priceSnapshots.externalId,
        priceSnapshots.variant,
        priceSnapshots.asOf,
      ],
      set: { priceCents },
    })
  } else {
    await insert.onConflictDoNothing()
  }
}

export interface LatestPrice {
  priceCents: number
  asOf: string
  /** The latest price dated at least 7 days before `asOf`, or null if none yet. */
  weekAgoPriceCents: number | null
}

/**
 * The latest snapshot of every price key, with the price from a week before
 * it, keyed by priceKeyString. One query: the week-ago price is a subquery
 * that the (source, external_id, variant, as_of) unique index answers directly.
 * The outer table is named in full on purpose: Drizzle leaves column names
 * unqualified in a single-table select, and inside the subquery an unqualified
 * `as_of` would mean w.as_of.
 */
export async function latestPrices(
  db: Db | Tx,
): Promise<Map<string, LatestPrice>> {
  const rows = await db
    .selectDistinctOn(
      [
        priceSnapshots.source,
        priceSnapshots.externalId,
        priceSnapshots.variant,
      ],
      {
        source: priceSnapshots.source,
        externalId: priceSnapshots.externalId,
        variant: priceSnapshots.variant,
        priceCents: priceSnapshots.priceCents,
        asOf: priceSnapshots.asOf,
        weekAgoPriceCents: sql<number | null>`(
          select w.price_cents from price_snapshots w
          where w.source = price_snapshots.source
            and w.external_id = price_snapshots.external_id
            and w.variant = price_snapshots.variant
            and w.as_of <= price_snapshots.as_of - 7
          order by w.as_of desc
          limit 1
        )`.mapWith(Number),
      },
    )
    .from(priceSnapshots)
    .orderBy(
      priceSnapshots.source,
      priceSnapshots.externalId,
      priceSnapshots.variant,
      desc(priceSnapshots.asOf),
    )
  return new Map(
    rows.map((r) => [
      priceKeyString(r),
      {
        priceCents: r.priceCents,
        asOf: r.asOf,
        weekAgoPriceCents: r.weekAgoPriceCents,
      },
    ]),
  )
}
