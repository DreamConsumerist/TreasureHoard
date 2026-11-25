// /api/transactions: the register and transaction CRUD.

import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm'
import { Hono } from 'hono'
import { accounts, postings, transactions } from '../../../db/schema.ts'
import type { Db } from '../../../db/types.ts'
import {
  transactionInputSchema,
  transactionListQuerySchema,
  type TransactionListQuery,
} from '../../ledger/schemas.ts'
import type {
  PostingOut,
  TransactionOut,
  TransactionPage,
} from '../../ledger/types.ts'
import { collectionAccountIds, linkedItemId } from '../collection/common.ts'
import { fail, idParam, validate } from '../errors.ts'

const LINKED_MESSAGE =
  'This transaction belongs to a collection item. Edit it from the item instead.'

const header = {
  id: transactions.id,
  date: transactions.date,
  description: transactions.description,
  notes: transactions.notes,
  status: transactions.status,
  kind: transactions.kind,
}

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`)

async function attachPostings<T extends { id: number }>(
  db: Db,
  rows: T[],
): Promise<(T & { postings: PostingOut[] })[]> {
  if (rows.length === 0) return []
  const all = await db
    .select({
      id: postings.id,
      transactionId: postings.transactionId,
      accountId: postings.accountId,
      amountCents: postings.amountCents,
      memo: postings.memo,
    })
    .from(postings)
    .where(
      inArray(
        postings.transactionId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(postings.id))
  return rows.map((row) => ({
    ...row,
    postings: all
      .filter((p) => p.transactionId === row.id)
      .map((p) => ({
        id: p.id,
        accountId: p.accountId,
        amountCents: p.amountCents,
        memo: p.memo,
      })),
  }))
}

/**
 * Lists transactions newest first, one page at a time (keyset pagination on
 * date then id). With `accountId`, each row also carries the account's
 * running balance, computed over that account's full history (opening
 * entries included) before any other filter is applied, so filtering never
 * changes the balances shown.
 */
export async function listTransactions(
  db: Db,
  q: TransactionListQuery,
): Promise<TransactionPage> {
  const where: SQL[] = []
  if (!q.includeOpening) where.push(ne(transactions.kind, 'opening'))
  if (q.from) where.push(sql`${transactions.date} >= ${q.from}`)
  if (q.to) where.push(sql`${transactions.date} <= ${q.to}`)
  if (q.status) where.push(eq(transactions.status, q.status))
  if (q.q) where.push(ilike(transactions.description, `%${likeEscape(q.q)}%`))
  if (q.cursor) {
    const [date, id] = q.cursor.split('_')
    where.push(
      sql`(${transactions.date}, ${transactions.id}) < (${date}, ${Number(id)})`,
    )
  }

  let rows: Omit<TransactionOut, 'postings'>[]
  if (q.accountId) {
    // The account's net amount per transaction (a split can touch it twice)…
    const amounts = db.$with('account_amounts').as(
      db
        .select({
          txnId: postings.transactionId,
          amount: sql<number>`sum(${postings.amountCents})`.as('amount'),
        })
        .from(postings)
        .where(eq(postings.accountId, q.accountId))
        .groupBy(postings.transactionId),
    )
    // …and the running total of those amounts in date order.
    const running = db.$with('running').as(
      db
        .with(amounts)
        .select({
          txnId: amounts.txnId,
          amount: amounts.amount,
          balance:
            sql<number>`sum(${amounts.amount}) over (order by ${transactions.date}, ${transactions.id})`.as(
              'balance',
            ),
        })
        .from(amounts)
        .innerJoin(transactions, eq(transactions.id, amounts.txnId)),
    )
    rows = await db
      .with(running)
      .select({
        ...header,
        accountAmountCents: sql<number>`${running.amount}`.mapWith(Number),
        runningBalanceCents: sql<number>`${running.balance}`.mapWith(Number),
      })
      .from(transactions)
      .innerJoin(running, eq(running.txnId, transactions.id))
      .where(and(...where))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(q.limit + 1)
  } else {
    rows = await db
      .select(header)
      .from(transactions)
      .where(and(...where))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(q.limit + 1)
  }

  // One extra row was fetched to learn whether another page exists.
  const hasMore = rows.length > q.limit
  const page = rows.slice(0, q.limit)
  const last = page.at(-1)
  return {
    items: await attachPostings(db, page),
    nextCursor: hasMore && last ? `${last.date}_${last.id}` : null,
  }
}

async function getTransaction(
  db: Db,
  id: number,
): Promise<TransactionOut | null> {
  const [row] = await db
    .select(header)
    .from(transactions)
    .where(eq(transactions.id, id))
  if (!row) return null
  const [withPostings] = await attachPostings(db, [row])
  return withPostings ?? null
}

/** Rejects postings to unknown accounts, and to archived accounts not already on this transaction. */
async function checkAccounts(
  db: Db,
  accountIds: number[],
  allowedArchived: Set<number>,
) {
  const ids = [...new Set(accountIds)]
  const found = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      archived: accounts.archived,
    })
    .from(accounts)
    .where(inArray(accounts.id, ids))
  if (found.length !== ids.length)
    fail(400, 'One or more accounts do not exist')
  const archived = found.find((a) => a.archived && !allowedArchived.has(a.id))
  if (archived) fail(400, `"${archived.name}" is archived`)
  // The Collection accounts only move with collection items (buy, add, sell),
  // so they always equal the items' cost. Posting to them by hand would break that.
  const collection = new Set(await collectionAccountIds(db))
  const intoCollection = found.find((a) => collection.has(a.id))
  if (intoCollection) {
    fail(
      400,
      `"${intoCollection.name}" is a Collection account. Add, buy or sell items from the Collection page instead.`,
    )
  }
}

export function transactionRoutes(db: Db) {
  const r = new Hono()

  r.get('/', validate('query', transactionListQuerySchema), async (c) => {
    return c.json(await listTransactions(db, c.req.valid('query')))
  })

  // GET /api/transactions/suggest?q=kro → recent distinct descriptions starting
  // with q, each with the postings it last used (to pre-fill the form).
  r.get('/suggest', async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (q.length === 0) return c.json([])
    const latest = await db
      .selectDistinctOn([sql`lower(${transactions.description})`], header)
      .from(transactions)
      .where(
        and(
          ne(transactions.kind, 'opening'),
          ilike(transactions.description, `${likeEscape(q)}%`),
        ),
      )
      .orderBy(
        sql`lower(${transactions.description})`,
        desc(transactions.date),
        desc(transactions.id),
      )
      .limit(8)
    const withPostings = await attachPostings(db, latest)
    withPostings.sort((a, b) => b.date.localeCompare(a.date))
    return c.json(
      withPostings.map(({ description, postings }) => ({
        description,
        postings,
      })),
    )
  })

  r.get('/:id', async (c) => {
    const id = idParam(c.req.param('id'))
    const txn = await getTransaction(db, id)
    if (!txn) fail(404, 'Transaction not found')
    return c.json({ ...txn, linkedItemId: await linkedItemId(db, id) })
  })

  r.post('/', validate('json', transactionInputSchema), async (c) => {
    const input = c.req.valid('json')
    await checkAccounts(
      db,
      input.postings.map((p) => p.accountId),
      new Set(),
    )
    const id = await db.transaction(async (tx) => {
      const [txn] = await tx
        .insert(transactions)
        .values({
          date: input.date,
          description: input.description,
          notes: input.notes ?? null,
          status: input.status,
        })
        .returning({ id: transactions.id })
      if (!txn) throw new Error('Insert returned no row')
      await tx.insert(postings).values(
        input.postings.map((p) => ({
          transactionId: txn.id,
          accountId: p.accountId,
          amountCents: p.amountCents,
          memo: p.memo ?? null,
        })),
      )
      return txn.id
    })
    return c.json(await getTransaction(db, id), 201)
  })

  // PUT replaces the header and every posting. The kind (normal/opening) is kept.
  r.put('/:id', validate('json', transactionInputSchema), async (c) => {
    const id = idParam(c.req.param('id'))
    const input = c.req.valid('json')
    const existing = await getTransaction(db, id)
    if (!existing) fail(404, 'Transaction not found')
    // Collection entries are kept in step with their item; editing them here
    // would break the Collection invariant.
    if (await linkedItemId(db, id)) fail(409, LINKED_MESSAGE)
    await checkAccounts(
      db,
      input.postings.map((p) => p.accountId),
      new Set(existing.postings.map((p) => p.accountId)),
    )
    await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({
          date: input.date,
          description: input.description,
          notes: input.notes ?? null,
          status: input.status,
          updatedAt: sql`now()`,
        })
        .where(eq(transactions.id, id))
      await tx.delete(postings).where(eq(postings.transactionId, id))
      await tx.insert(postings).values(
        input.postings.map((p) => ({
          transactionId: id,
          accountId: p.accountId,
          amountCents: p.amountCents,
          memo: p.memo ?? null,
        })),
      )
    })
    return c.json(await getTransaction(db, id))
  })

  r.delete('/:id', async (c) => {
    const id = idParam(c.req.param('id'))
    if (await linkedItemId(db, id)) fail(409, LINKED_MESSAGE)
    const deleted = await db
      .delete(transactions)
      .where(eq(transactions.id, id))
      .returning({ id: transactions.id })
    if (deleted.length === 0) fail(404, 'Transaction not found')
    return c.json({ ok: true })
  })

  return r
}
