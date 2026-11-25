// Helpers shared by the collection routes and the ledger routes that need to
// know about the collection (dashboard, transaction protection).

import { eq, inArray, or, sql } from 'drizzle-orm'
import { accounts, items, postings } from '../../../db/schema.ts'
import type { Db, Tx } from '../../../db/types.ts'
import { fail } from '../errors.ts'

/** Account id for a system_key ('collection_card', 'realized_gains', …). */
export async function systemAccountId(
  db: Db | Tx,
  key: string,
): Promise<number> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.systemKey, key))
  if (!row) fail(500, `System account "${key}" is missing`)
  return row.id
}

/** Ids of the Collection account and every account beneath it. */
export async function collectionAccountIds(db: Db | Tx): Promise<number[]> {
  const all = await db
    .select({
      id: accounts.id,
      parentId: accounts.parentId,
      systemKey: accounts.systemKey,
    })
    .from(accounts)
  const root = all.find((a) => a.systemKey === 'collection')
  if (!root) return []
  const ids = [root.id]
  for (let i = 0; i < ids.length; i++) {
    for (const a of all) if (a.parentId === ids[i]) ids.push(a.id)
  }
  return ids
}

/** Sum of postings to the Collection subtree (debit-positive): the collection at cost. */
export async function collectionLedgerCents(db: Db | Tx): Promise<number> {
  const ids = await collectionAccountIds(db)
  if (ids.length === 0) return 0
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${postings.amountCents}), 0)`.mapWith(
        Number,
      ),
    })
    .from(postings)
    .where(inArray(postings.accountId, ids))
  return row?.total ?? 0
}

/** The item a transaction belongs to (as its purchase/opening entry or its sale), if any. */
export async function linkedItemId(
  db: Db | Tx,
  txnId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ id: items.id })
    .from(items)
    .where(or(eq(items.acquiredTxnId, txnId), eq(items.soldTxnId, txnId)))
    .limit(1)
  return row?.id ?? null
}
