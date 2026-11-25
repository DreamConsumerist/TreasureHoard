// /api/recurring: recurring templates, the catch-up that creates due
// occurrences, and the Dashboard's due list and "Owed to you" figures.
//
// Generation is lazy: nothing runs on a timer. When the app opens it calls
// POST /api/recurring/catch-up with the browser's local date, and every
// occurrence due on or before that date is created as a pending transaction.
// The unique (recurring_template_id, occurrence_date) key makes this safe to
// run twice at once (two tabs): the second insert does nothing.

import { and, asc, desc, eq, inArray, isNotNull, max, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  accounts,
  postings,
  recurringTemplatePostings,
  recurringTemplates,
  transactions,
} from '../../../db/schema.ts'
import type { Db, Tx } from '../../../db/types.ts'
import type { PostingInput } from '../../ledger/postings.ts'
import {
  firstIndexAfter,
  occurrenceDate,
  occurrencesFrom,
  rescaleToTotal,
  transactionTotal,
  type Schedule,
} from '../../ledger/recurring.ts'
import { catchUpSchema, recurringInputSchema } from '../../ledger/schemas.ts'
import type {
  DueOccurrence,
  OwedToYou,
  PostingOut,
  RecurringTemplateOut,
  UpcomingOccurrence,
} from '../../ledger/types.ts'
import { fail, idParam, validate } from '../errors.ts'
import { attachPostings, checkAccounts, header } from './transactions.ts'

/** Most occurrences one template creates per catch-up, so a start date set years back can't flood the ledger. */
export const MAX_PER_CATCH_UP = 60
const UPCOMING_DAYS = 7

type TemplateRow = typeof recurringTemplates.$inferSelect

async function templatePostings(db: Db | Tx, ids: number[]) {
  if (ids.length === 0) return new Map<number, PostingOut[]>()
  const rows = await db
    .select()
    .from(recurringTemplatePostings)
    .where(inArray(recurringTemplatePostings.templateId, ids))
    .orderBy(asc(recurringTemplatePostings.id))
  const map = new Map<number, PostingOut[]>()
  for (const r of rows) {
    const list = map.get(r.templateId) ?? []
    list.push({
      id: r.id,
      accountId: r.accountId,
      amountCents: r.amountCents,
      memo: r.memo,
    })
    map.set(r.templateId, list)
  }
  return map
}

/**
 * What a new occurrence should say. A fixed template uses its own postings.
 * A variable one (utilities) uses its own split scaled to the last confirmed
 * bill's total, so the estimate follows recent bills. That only applies if
 * the bill was confirmed after the template was last edited: an edit wins.
 */
async function estimatePostings(
  db: Db | Tx,
  t: TemplateRow,
  own: PostingInput[],
): Promise<PostingInput[]> {
  if (!t.variable) return own
  const [last] = await db
    .select({ id: transactions.id, updatedAt: transactions.updatedAt })
    .from(transactions)
    .where(
      and(
        eq(transactions.recurringTemplateId, t.id),
        eq(transactions.status, 'cleared'),
      ),
    )
    .orderBy(desc(transactions.occurrenceDate))
    .limit(1)
  if (!last || last.updatedAt < t.updatedAt) return own
  const lastPostings = await db
    .select({ amountCents: postings.amountCents })
    .from(postings)
    .where(eq(postings.transactionId, last.id))
  return rescaleToTotal(own, transactionTotal(lastPostings)) ?? own
}

const scheduleOf = (t: TemplateRow): Schedule => ({
  frequency: t.frequency,
  interval: t.interval,
  startDate: t.startDate,
  endDate: t.endDate,
})

/** Creates every occurrence due on or before `today`. Returns how many were created. */
export async function generateDue(db: Db, today: string): Promise<number> {
  const templates = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.active, true))
  const own = await templatePostings(
    db,
    templates.map((t) => t.id),
  )
  let created = 0
  for (const t of templates) {
    const schedule = scheduleOf(t)
    if (occurrenceDate(schedule, t.nextIndex) > today) continue // nothing due
    created += await db.transaction(async (tx) => {
      const lines = await estimatePostings(tx, t, own.get(t.id) ?? [])
      let k = t.nextIndex
      let made = 0
      for (let n = 0; n < MAX_PER_CATCH_UP; n++, k++) {
        const date = occurrenceDate(schedule, k)
        if (date > today || (t.endDate && date > t.endDate)) break
        const [txn] = await tx
          .insert(transactions)
          .values({
            date,
            description: t.description,
            notes: t.notes,
            status: 'pending',
            recurringTemplateId: t.id,
            occurrenceDate: date,
          })
          .onConflictDoNothing()
          .returning({ id: transactions.id })
        if (!txn) continue // another catch-up made it first
        await tx.insert(postings).values(
          lines.map((p) => ({
            transactionId: txn.id,
            accountId: p.accountId,
            amountCents: p.amountCents,
            memo: p.memo ?? null,
          })),
        )
        made++
      }
      // Only ever move forward, in case a concurrent catch-up got further.
      await tx
        .update(recurringTemplates)
        .set({
          nextIndex: sql`greatest(${recurringTemplates.nextIndex}, ${k})`,
        })
        .where(eq(recurringTemplates.id, t.id))
      return made
    })
  }
  return created
}

async function loadTemplates(
  db: Db,
  id?: number,
): Promise<RecurringTemplateOut[]> {
  const rows = await db
    .select()
    .from(recurringTemplates)
    .where(id === undefined ? undefined : eq(recurringTemplates.id, id))
    .orderBy(asc(sql`lower(${recurringTemplates.description})`))
  const own = await templatePostings(
    db,
    rows.map((r) => r.id),
  )
  const pending = await db
    .select({
      templateId: transactions.recurringTemplateId,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(transactions)
    .where(
      and(
        isNotNull(transactions.recurringTemplateId),
        eq(transactions.status, 'pending'),
      ),
    )
    .groupBy(transactions.recurringTemplateId)
  return rows.map((t) => {
    const upcoming = t.active
      ? occurrencesFrom(scheduleOf(t), t.nextIndex, 3)
      : []
    return {
      id: t.id,
      description: t.description,
      notes: t.notes,
      frequency: t.frequency,
      interval: t.interval,
      startDate: t.startDate,
      endDate: t.endDate,
      variable: t.variable,
      active: t.active,
      postings: own.get(t.id) ?? [],
      nextDue: upcoming[0] ?? null,
      upcoming,
      pendingCount: pending.find((p) => p.templateId === t.id)?.n ?? 0,
    }
  })
}

/** Template accounts follow the transaction rules: they must exist, be open, and not be Collection accounts. */
async function checkTemplateAccounts(
  db: Db,
  lines: PostingInput[],
  existing: PostingOut[] = [],
) {
  await checkAccounts(
    db,
    lines.map((p) => p.accountId),
    new Set(existing.map((p) => p.accountId)),
  )
}

const postingRows = (templateId: number, lines: PostingInput[]) =>
  lines.map((p) => ({
    templateId,
    accountId: p.accountId,
    amountCents: p.amountCents,
    memo: p.memo ?? null,
  }))

export function recurringRoutes(db: Db) {
  const r = new Hono()

  r.get('/', async (c) => c.json(await loadTemplates(db)))

  r.get('/:id', async (c) => {
    const [t] = await loadTemplates(db, idParam(c.req.param('id')))
    if (!t) fail(404, 'Recurring transaction not found')
    return c.json(t)
  })

  r.post('/', validate('json', recurringInputSchema), async (c) => {
    const input = c.req.valid('json')
    await checkTemplateAccounts(db, input.postings)
    const id = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(recurringTemplates)
        .values({
          description: input.description,
          notes: input.notes ?? null,
          frequency: input.frequency,
          interval: input.interval,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          variable: input.variable,
          active: input.active,
        })
        .returning({ id: recurringTemplates.id })
      await tx
        .insert(recurringTemplatePostings)
        .values(postingRows(t!.id, input.postings))
      return t!.id
    })
    const [out] = await loadTemplates(db, id)
    return c.json(out, 201)
  })

  // Edits apply to future occurrences only: transactions already created keep
  // their amounts. A schedule change restarts counting after the last
  // occurrence already created, so editing never re-creates a past bill.
  r.put('/:id', validate('json', recurringInputSchema), async (c) => {
    const id = idParam(c.req.param('id'))
    const input = c.req.valid('json')
    const [existing] = await db
      .select()
      .from(recurringTemplates)
      .where(eq(recurringTemplates.id, id))
    if (!existing) fail(404, 'Recurring transaction not found')
    await checkTemplateAccounts(
      db,
      input.postings,
      (await templatePostings(db, [id])).get(id),
    )

    let nextIndex = existing.nextIndex
    const scheduleChanged =
      existing.frequency !== input.frequency ||
      existing.interval !== input.interval ||
      existing.startDate !== input.startDate
    if (scheduleChanged) {
      const [last] = await db
        .select({ date: max(transactions.occurrenceDate) })
        .from(transactions)
        .where(eq(transactions.recurringTemplateId, id))
      nextIndex = last?.date
        ? firstIndexAfter(
            {
              frequency: input.frequency,
              interval: input.interval,
              startDate: input.startDate,
            },
            last.date,
          )
        : 0
    }

    await db.transaction(async (tx) => {
      await tx
        .update(recurringTemplates)
        .set({
          description: input.description,
          notes: input.notes ?? null,
          frequency: input.frequency,
          interval: input.interval,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          variable: input.variable,
          active: input.active,
          nextIndex,
          updatedAt: sql`now()`,
        })
        .where(eq(recurringTemplates.id, id))
      await tx
        .delete(recurringTemplatePostings)
        .where(eq(recurringTemplatePostings.templateId, id))
      await tx
        .insert(recurringTemplatePostings)
        .values(postingRows(id, input.postings))
    })
    const [out] = await loadTemplates(db, id)
    return c.json(out)
  })

  // Transactions the template already created stay; they just lose the link.
  r.delete('/:id', async (c) => {
    const id = idParam(c.req.param('id'))
    const deleted = await db
      .delete(recurringTemplates)
      .where(eq(recurringTemplates.id, id))
      .returning({ id: recurringTemplates.id })
    if (deleted.length === 0) fail(404, 'Recurring transaction not found')
    return c.json({ ok: true })
  })

  r.post('/catch-up', validate('json', catchUpSchema), async (c) => {
    return c.json({ created: await generateDue(db, c.req.valid('json').today) })
  })

  return r
}

// --- Dashboard figures ---------------------------------------------------------

/** Pending transactions made by templates, oldest first. */
export async function dueOccurrences(db: Db): Promise<DueOccurrence[]> {
  const rows = await db
    .select({ ...header, variable: recurringTemplates.variable })
    .from(transactions)
    .innerJoin(
      recurringTemplates,
      eq(recurringTemplates.id, transactions.recurringTemplateId),
    )
    .where(eq(transactions.status, 'pending'))
    .orderBy(asc(transactions.date), asc(transactions.id))
  const withPostings = await attachPostings(db, rows)
  return withPostings.map(({ variable, ...transaction }) => ({
    transaction,
    variable,
  }))
}

/** Occurrences after `today` and within the next week (not created yet). */
export async function upcomingOccurrences(
  db: Db,
  today: string,
): Promise<UpcomingOccurrence[]> {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const until = new Date(Date.UTC(y, m - 1, d + UPCOMING_DAYS))
    .toISOString()
    .slice(0, 10)
  const templates = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.active, true))
  const own = await templatePostings(
    db,
    templates.map((t) => t.id),
  )
  const out: UpcomingOccurrence[] = []
  for (const t of templates) {
    const schedule = scheduleOf(t)
    for (let k = t.nextIndex; ; k++) {
      const date = occurrenceDate(schedule, k)
      if (date > until || (t.endDate && date > t.endDate)) break
      if (date <= today) continue // due, but the catch-up hasn't run yet
      out.push({
        templateId: t.id,
        description: t.description,
        date,
        amountCents: transactionTotal(own.get(t.id) ?? []),
        variable: t.variable,
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Ids of the "Owed to me" account and everything beneath it. */
export async function receivableAccountIds(db: Db): Promise<number[]> {
  const all = await db
    .select({
      id: accounts.id,
      parentId: accounts.parentId,
      systemKey: accounts.systemKey,
    })
    .from(accounts)
  const root = all.find((a) => a.systemKey === 'receivables')
  if (!root) return []
  const ids = [root.id]
  for (let i = 0; i < ids.length; i++) {
    for (const a of all) if (a.parentId === ids[i]) ids.push(a.id)
  }
  return ids
}

/**
 * Each account under "Owed to me" (and the account itself, if posted to
 * directly) with a non-zero balance, largest first. A payment received is a
 * credit to the account, so the last payment is its latest credit.
 */
export async function owedToYou(db: Db, ids: number[]): Promise<OwedToYou[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({
      accountId: accounts.id,
      name: accounts.name,
      balanceCents: sql<number>`sum(${postings.amountCents})`.mapWith(Number),
      lastPaymentDate: sql<
        string | null
      >`(max(${transactions.date}) filter (where ${postings.amountCents} < 0))::text`,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(inArray(postings.accountId, ids))
    .groupBy(accounts.id, accounts.name)
    .having(sql`sum(${postings.amountCents}) <> 0`)
  return rows.sort((a, b) => b.balanceCents - a.balanceCents)
}
