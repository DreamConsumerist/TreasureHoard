// /api/collection/check: the Collection invariant. The Collection account
// subtree must equal the summed cost basis of unsold items. Every collection
// write keeps them in step and linked transactions can't be edited from the
// ledger, so a mismatch means something bypassed both: worth knowing about.

import { isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { items } from '../../../db/schema.ts'
import type { Db } from '../../../db/types.ts'
import type { CollectionCheck } from '../../collection/types.ts'
import { collectionLedgerCents } from './common.ts'

export function checkRoutes(db: Db) {
  const r = new Hono()
  r.get('/check', async (c) => {
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${items.costBasisCents}), 0)`.mapWith(
          Number,
        ),
      })
      .from(items)
      .where(isNull(items.soldDate))
    const itemsCents = row?.total ?? 0
    const ledgerCents = await collectionLedgerCents(db)
    const out: CollectionCheck = {
      ok: itemsCents === ledgerCents,
      ledgerCents,
      itemsCents,
    }
    return c.json(out)
  })
  return r
}
