// /api/accounts: the chart of accounts.

import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { accounts, postings, transactions } from '../../../db/schema.ts'
import type { Db } from '../../../db/types.ts'
import {
  accountCreateSchema,
  accountUpdateSchema,
} from '../../ledger/schemas.ts'
import { isDebitNormal, type AccountType } from '../../ledger/sign.ts'
import { fail, idParam, validate } from '../errors.ts'

export const OPENING_BALANCES_KEY = 'opening_balances'

/** UTC calendar date; only a fallback, since the client normally sends its local date. */
export const todayUtc = () => new Date().toISOString().slice(0, 10)

/** A database handle inside db.transaction(). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Creates, updates or removes an account's fresh-start opening entry, so the
 * account starts at `naturalCents` (natural sign: money in the bank, or the
 * amount owed on a card). 0 removes the entry. The entry is a `kind='opening'`
 * transaction between this account and Opening Balances; an account has at
 * most one. Call inside a db.transaction().
 */
export async function setOpeningBalance(
  tx: Tx,
  account: { id: number; name: string; type: AccountType },
  naturalCents: number,
  date: string | undefined,
) {
  const [opening] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.systemKey, OPENING_BALANCES_KEY))
  if (!opening) fail(500, 'Opening Balances account is missing')
  if (account.id === opening.id) {
    fail(400, "Opening Balances can't have an opening balance of its own")
  }

  const [existing] = await tx
    .select({ id: transactions.id, date: transactions.date })
    .from(transactions)
    .innerJoin(postings, eq(postings.transactionId, transactions.id))
    .where(
      and(eq(transactions.kind, 'opening'), eq(postings.accountId, account.id)),
    )
    .limit(1)

  if (naturalCents === 0) {
    if (existing) {
      await tx.delete(transactions).where(eq(transactions.id, existing.id))
    }
    return
  }

  // Convert natural sign to stored (debit-positive).
  const stored = isDebitNormal(account.type) ? naturalCents : -naturalCents
  const header = {
    date: date ?? existing?.date ?? todayUtc(),
    description: `Opening balance: ${account.name}`,
    status: 'cleared' as const,
    kind: 'opening' as const,
  }
  let txnId: number
  if (existing) {
    await tx
      .update(transactions)
      .set({ ...header, updatedAt: sql`now()` })
      .where(eq(transactions.id, existing.id))
    await tx.delete(postings).where(eq(postings.transactionId, existing.id))
    txnId = existing.id
  } else {
    const [txn] = await tx
      .insert(transactions)
      .values(header)
      .returning({ id: transactions.id })
    if (!txn) throw new Error('Insert returned no row')
    txnId = txn.id
  }
  await tx.insert(postings).values([
    { transactionId: txnId, accountId: account.id, amountCents: stored },
    { transactionId: txnId, accountId: opening.id, amountCents: -stored },
  ])
}

export function accountRoutes(db: Db) {
  const r = new Hono()

  // GET /api/accounts → every account with its balances (debit-positive),
  // plus its opening entry if it has one (stored sign, and its date).
  r.get('/', async (c) => {
    const [rows, openings] = await Promise.all([
      db
        .select({
          id: accounts.id,
          name: accounts.name,
          type: accounts.type,
          parentId: accounts.parentId,
          systemKey: accounts.systemKey,
          archived: accounts.archived,
          balanceCents:
            sql<number>`coalesce(sum(${postings.amountCents}), 0)`.mapWith(
              Number,
            ),
          clearedBalanceCents:
            sql<number>`coalesce(sum(${postings.amountCents}) filter (where ${transactions.status} = 'cleared'), 0)`.mapWith(
              Number,
            ),
        })
        .from(accounts)
        .leftJoin(postings, eq(postings.accountId, accounts.id))
        .leftJoin(transactions, eq(transactions.id, postings.transactionId))
        .groupBy(accounts.id)
        .orderBy(accounts.name),
      // Each account's side of its opening entry (Opening Balances' own side excluded).
      db
        .select({
          accountId: postings.accountId,
          cents: postings.amountCents,
          date: transactions.date,
        })
        .from(postings)
        .innerJoin(transactions, eq(transactions.id, postings.transactionId))
        .innerJoin(accounts, eq(accounts.id, postings.accountId))
        .where(
          and(
            eq(transactions.kind, 'opening'),
            or(
              isNull(accounts.systemKey),
              ne(accounts.systemKey, OPENING_BALANCES_KEY),
            ),
          ),
        ),
    ])
    const byAccount = new Map(openings.map((o) => [o.accountId, o]))
    return c.json(
      rows.map((row) => ({
        ...row,
        openingBalanceCents: byAccount.get(row.id)?.cents ?? null,
        openingDate: byAccount.get(row.id)?.date ?? null,
      })),
    )
  })

  // POST /api/accounts → create, optionally with a fresh-start opening balance.
  r.post('/', validate('json', accountCreateSchema), async (c) => {
    const input = c.req.valid('json')
    const parentId = input.parentId ?? null
    if (parentId !== null) {
      const [parent] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, parentId))
      if (!parent) fail(400, 'Parent account not found')
      if (parent.type !== input.type)
        fail(400, 'A sub-account must have the same type as its parent')
    }

    const created = await db.transaction(async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({ name: input.name, type: input.type, parentId })
        .returning()
      if (!account) throw new Error('Insert returned no row')
      if (input.openingBalanceCents) {
        await setOpeningBalance(
          tx,
          account,
          input.openingBalanceCents,
          input.openingDate,
        )
      }
      return account
    })
    return c.json(created, 201)
  })

  // PATCH /api/accounts/:id → rename, move, archive/unarchive, and set or
  // change the opening balance (0 removes it). Type is fixed.
  r.patch('/:id', validate('json', accountUpdateSchema), async (c) => {
    const id = idParam(c.req.param('id'))
    const input = c.req.valid('json')
    const all = await db.select().from(accounts)
    const account = all.find((a) => a.id === id)
    if (!account) fail(404, 'Account not found')

    if (input.parentId !== undefined && input.parentId !== null) {
      const parent = all.find((a) => a.id === input.parentId)
      if (!parent) fail(400, 'Parent account not found')
      if (parent.type !== account.type) {
        fail(400, 'A sub-account must have the same type as its parent')
      }
      // Walk up from the new parent: reaching this account would create a cycle.
      for (let p: typeof parent | undefined = parent; p;) {
        if (p.id === id) fail(400, "An account can't be moved under itself")
        p =
          p.parentId === null
            ? undefined
            : all.find((a) => a.id === p!.parentId)
      }
    }

    const changes = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.parentId !== undefined && { parentId: input.parentId }),
      ...(input.archived !== undefined && { archived: input.archived }),
    }
    const updated = await db.transaction(async (tx) => {
      // A PATCH may only touch the opening balance; an empty SET isn't valid SQL.
      const [row] =
        Object.keys(changes).length > 0
          ? await tx
              .update(accounts)
              .set(changes)
              .where(eq(accounts.id, id))
              .returning()
          : [account]
      if (!row) throw new Error('Update returned no row')
      if (input.openingBalanceCents !== undefined) {
        await setOpeningBalance(
          tx,
          row,
          input.openingBalanceCents,
          input.openingDate,
        )
      } else if (input.name !== undefined) {
        // Keep the opening entry's description in step with a rename.
        await tx
          .update(transactions)
          .set({ description: `Opening balance: ${row.name}` })
          .where(
            and(
              eq(transactions.kind, 'opening'),
              sql`${transactions.id} in (select ${postings.transactionId} from ${postings} where ${postings.accountId} = ${id})`,
            ),
          )
      }
      return row
    })
    return c.json(updated)
  })

  // DELETE /api/accounts/:id → only for unused, childless, non-system accounts.
  r.delete('/:id', async (c) => {
    const id = idParam(c.req.param('id'))
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
    if (!account) fail(404, 'Account not found')
    if (account.systemKey)
      fail(409, "This account is used by the app and can't be deleted")
    const [child] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.parentId, id))
      .limit(1)
    if (child)
      fail(409, 'This account has sub-accounts. Move or delete them first.')
    const [used] = await db
      .select({ id: postings.id })
      .from(postings)
      .where(eq(postings.accountId, id))
      .limit(1)
    if (used)
      fail(
        409,
        'This account has transactions (or an opening balance). Archive it instead.',
      )
    await db.delete(accounts).where(eq(accounts.id, id))
    return c.json({ ok: true })
  })

  return r
}
