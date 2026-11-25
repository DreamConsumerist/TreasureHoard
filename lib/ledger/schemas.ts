// Zod schemas for API request bodies and query strings. The API validates with
// them (via @hono/zod-validator); the frontend uses the inferred types so both
// sides agree on the shapes.

import { z } from 'zod'
import { validatePostings } from './postings.ts'
import { FREQUENCIES } from './recurring.ts'
import { ACCOUNT_TYPES } from './sign.ts'

const id = z.int().positive()
const isoDate = z.iso.date() // 'YYYY-MM-DD'
const cents = z.int().refine(Number.isSafeInteger, 'Amount is too large')
const name = z.string().trim().min(1, 'Name is required').max(100)

export const accountCreateSchema = z.object({
  name,
  type: z.enum(ACCOUNT_TYPES),
  parentId: id.nullable().optional(),
  // Fresh-start balance in natural sign (what you'd read on a statement:
  // money in the bank, or the amount owed on a card).
  openingBalanceCents: cents.optional(),
  openingDate: isoDate.optional(),
})
export type AccountCreate = z.infer<typeof accountCreateSchema>

export const accountUpdateSchema = z.object({
  name: name.optional(),
  parentId: id.nullable().optional(),
  archived: z.boolean().optional(),
  // Natural sign, like on create. 0 removes the opening entry.
  openingBalanceCents: cents.optional(),
  openingDate: isoDate.optional(),
})
export type AccountUpdate = z.infer<typeof accountUpdateSchema>

export const postingSchema = z.object({
  accountId: id,
  amountCents: cents,
  memo: z.string().trim().max(200).nullable().optional(),
})

export const transactionInputSchema = z
  .object({
    date: isoDate,
    description: z.string().trim().min(1, 'Description is required').max(200),
    notes: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(['pending', 'cleared']).default('cleared'),
    postings: z.array(postingSchema).max(50),
  })
  .superRefine((t, ctx) => {
    for (const message of validatePostings(t.postings)) {
      ctx.addIssue({ code: 'custom', path: ['postings'], message })
    }
  })
export type TransactionInput = z.input<typeof transactionInputSchema>

// Query strings arrive as text, so numbers and booleans are coerced.
export const transactionListQuerySchema = z.object({
  accountId: z.coerce.number().pipe(id).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(['pending', 'cleared']).optional(),
  q: z.string().trim().max(100).optional(),
  includeOpening: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  // Opaque cursor from the previous page: "<date>_<id>" of its last row.
  cursor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}_\d+$/)
    .optional(),
  limit: z.coerce.number().pipe(z.int().min(1).max(200)).default(50),
})
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>

// --- Recurring templates ---

export const recurringInputSchema = z
  .object({
    description: z.string().trim().min(1, 'Description is required').max(200),
    notes: z.string().trim().max(2000).nullable().optional(),
    frequency: z.enum(FREQUENCIES),
    interval: z.int().min(1).max(99).default(1),
    startDate: isoDate,
    endDate: isoDate.nullable().optional(),
    variable: z.boolean().default(false),
    active: z.boolean().default(true),
    postings: z.array(postingSchema).max(50),
  })
  .superRefine((t, ctx) => {
    for (const message of validatePostings(t.postings)) {
      ctx.addIssue({ code: 'custom', path: ['postings'], message })
    }
    if (t.endDate && t.endDate < t.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'The end date is before the start date',
      })
    }
  })
export type RecurringInput = z.input<typeof recurringInputSchema>

// The browser's local date, so "due today" matches your calendar.
export const catchUpSchema = z.object({ today: isoDate })
