// /api/dashboard: the headline numbers for the home page.

import { and, desc, eq, gte, lt, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { accounts, postings, transactions } from '../../../db/schema.ts'
import type { Db } from '../../../db/types.ts'
import { collectionLedgerCents } from '../collection/common.ts'
import { validate } from '../errors.ts'
import { todayUtc } from './accounts.ts'
import { listTransactions } from './transactions.ts'

// The client sends its local date, so "this month" matches the user's calendar
// rather than the server's UTC clock.
const dashboardQuerySchema = z.object({ today: z.iso.date().optional() })

/** First day of the month containing `date`, shifted by `offset` months. 'YYYY-MM-DD'. */
export function monthStart(date: string, offset = 0): string {
  const [y, m] = date.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  return d.toISOString().slice(0, 10)
}

export function dashboardRoutes(db: Db) {
  const r = new Hono()

  r.get('/', validate('query', dashboardQuerySchema), async (c) => {
    const today = c.req.valid('query').today ?? todayUtc()
    const thisMonth = monthStart(today)
    const nextMonth = monthStart(today, 1)
    const lastMonth = monthStart(today, -1)

    // Totals per account type (debit-positive).
    const byType = await db
      .select({
        type: accounts.type,
        total: sql<number>`coalesce(sum(${postings.amountCents}), 0)`.mapWith(
          Number,
        ),
      })
      .from(postings)
      .innerJoin(accounts, eq(accounts.id, postings.accountId))
      .groupBy(accounts.type)
    const total = (type: string) =>
      byType.find((t) => t.type === type)?.total ?? 0

    // Expense postings per account within [from, to), excluding opening entries.
    const spendingBetween = (from: string, to: string) =>
      db
        .select({
          accountId: accounts.id,
          name: accounts.name,
          cents: sql<number>`sum(${postings.amountCents})`.mapWith(Number),
        })
        .from(postings)
        .innerJoin(accounts, eq(accounts.id, postings.accountId))
        .innerJoin(transactions, eq(transactions.id, postings.transactionId))
        .where(
          and(
            eq(accounts.type, 'expense'),
            ne(transactions.kind, 'opening'),
            gte(transactions.date, from),
            lt(transactions.date, to),
          ),
        )
        .groupBy(accounts.id, accounts.name)
        .orderBy(desc(sql`sum(${postings.amountCents})`))

    const [current, previous, recent, collectionCostCents] = await Promise.all([
      spendingBetween(thisMonth, nextMonth),
      spendingBetween(lastMonth, thisMonth),
      listTransactions(db, { limit: 8 }),
      collectionLedgerCents(db),
    ])
    const sum = (rows: { cents: number }[]) =>
      rows.reduce((s, r) => s + r.cents, 0)

    return c.json({
      // Assets minus liabilities. Liabilities are stored negative (credits), so it's a sum.
      // Includes the Collection at cost; Step 4 adds the market-value view.
      bookNetWorthCents: total('asset') + total('liability'),
      // Cash = every asset account except the Collection.
      cashCents: total('asset') - collectionCostCents,
      collectionCostCents,
      spending: {
        thisMonthCents: sum(current),
        lastMonthCents: sum(previous),
        topCategories: current.slice(0, 5),
      },
      recent: recent.items,
    })
  })

  return r
}
