// Zod schemas for the collection API. Shared with the frontend for types.

import { z } from 'zod'
import { ITEM_KINDS } from './accounting.ts'

const id = z.int().positive()
const isoDate = z.iso.date()
const cents = z.int().min(0)
const optText = (max: number) =>
  z.string().trim().max(max).nullable().optional()

export const GAME_VARIANTS = ['loose', 'cib', 'new'] as const
export const GAME_KEYS = ['mtg', 'onepiece', 'riftbound'] as const

export const cardDetailsSchema = z.object({
  categoryId: id,
  groupId: id,
  productId: id,
  subType: optText(40),
  setName: z.string().trim().min(1).max(200),
  number: optText(40),
  rarity: optText(60),
  imageUrl: z.url().max(500).nullable().optional(),
})

export const gameDetailsSchema = z.object({
  platform: z.string().trim().min(1).max(100),
  url: z.url().max(500).nullable().optional(), // null = priced by hand
  variant: z.enum(GAME_VARIANTS),
  imageUrl: z.url().max(500).nullable().optional(),
})

// A unit price seen at lookup (or typed in for an unlisted item). The server
// files it under the item's own price key (lib/collection/prices.ts).
export const observedPriceSchema = z.object({
  priceCents: cents,
  asOf: isoDate,
})

export const itemCreateSchema = z
  .object({
    kind: z.enum(ITEM_KINDS),
    name: z.string().trim().min(1, 'Name is required').max(200),
    quantity: z.int().min(1).max(100_000).default(1),
    condition: optText(60),
    notes: optText(2000),
    card: cardDetailsSchema.optional(),
    game: gameDetailsSchema.optional(),
    acquisition: z.discriminatedUnion('mode', [
      z.object({
        mode: z.literal('purchase'),
        date: isoDate,
        costCents: cents,
        fromAccountId: id,
      }),
      z.object({
        mode: z.literal('baseline'),
        date: isoDate,
        valueCents: cents,
      }),
    ]),
    // Stored as the item's first price snapshot.
    observedPrice: observedPriceSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const tcg = v.kind === 'card' || v.kind === 'sealed'
    if (tcg && !v.card) {
      ctx.addIssue({
        code: 'custom',
        path: ['card'],
        message: 'Pick a product from the lookup',
      })
    }
    if (!tcg && !v.game) {
      ctx.addIssue({
        code: 'custom',
        path: ['game'],
        message: 'Platform and variant are required',
      })
    }
  })
export type ItemCreate = z.input<typeof itemCreateSchema>

export const itemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  quantity: z.int().min(1).max(100_000).optional(),
  condition: optText(60),
  notes: optText(2000),
  costBasisCents: cents.optional(),
  acquiredDate: isoDate.optional(),
  subType: optText(40),
  platform: z.string().trim().min(1).max(100).optional(),
  variant: z.enum(GAME_VARIANTS).optional(),
  // For items without a lookup source: today's value per unit, recorded as a snapshot.
  manualPriceCents: cents.optional(),
  today: isoDate.optional(),
})
export type ItemUpdate = z.infer<typeof itemUpdateSchema>

export const itemSellSchema = z.object({
  date: isoDate,
  quantity: z.int().min(1),
  proceedsCents: cents,
  // Where the money went. Not needed for a $0 sale (a giveaway).
  toAccountId: id.optional(),
})
export type ItemSell = z.infer<typeof itemSellSchema>

export const itemListQuerySchema = z.object({
  kind: z.enum(ITEM_KINDS).optional(),
  status: z.enum(['owned', 'sold']).default('owned'),
  q: z.string().trim().max(100).optional(),
})
