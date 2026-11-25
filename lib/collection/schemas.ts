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
    // The collection group (deck, binder) to put it in.
    itemGroupId: id.nullable().optional(),
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
export type ItemCreateParsed = z.output<typeof itemCreateSchema>

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
  // Move to a collection group; null takes it out of its group.
  itemGroupId: id.nullable().optional(),
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
  // A collection group's id, or 'none' for items in no group.
  itemGroup: z
    .union([z.literal('none'), z.coerce.number().pipe(id)])
    .optional(),
})

// --- Collection groups ---

const groupName = z.string().trim().min(1, 'Name is required').max(100)

export const groupCreateSchema = z.object({
  name: groupName,
  notes: optText(2000),
})
export type GroupCreate = z.infer<typeof groupCreateSchema>

export const groupUpdateSchema = z.object({
  name: groupName.optional(),
  notes: optText(2000),
  // null = use its most valuable item's picture.
  coverItemId: id.nullable().optional(),
})
export type GroupUpdate = z.infer<typeof groupUpdateSchema>

export const groupAddItemsSchema = z.object({
  itemIds: z.array(id).min(1).max(500),
})

// --- Decklist import ---

export const importPreviewSchema = z.object({
  game: z.enum(GAME_KEYS),
  text: z.string().max(50_000),
})

export const importLineSchema = z.object({
  categoryId: id,
  groupId: id, // TCGplayer set
  setName: z.string().trim().min(1).max(200),
  productId: id,
  name: z.string().trim().min(1).max(200),
  number: optText(40),
  rarity: optText(60),
  imageUrl: z.url().max(500).nullable().optional(),
  subType: z.string().trim().min(1).max(40),
  quantity: z.int().min(1).max(1000),
  condition: optText(60),
  /** Unit market price; needed only when copies are added new. */
  priceCents: cents.nullable(),
  /** false = add every copy new, ignoring copies you already own. */
  useExisting: z.boolean().default(true),
})

export const importSchema = z
  .object({
    date: isoDate,
    itemGroupId: id.optional(),
    newGroupName: z.string().trim().min(1).max(100).optional(),
    lines: z.array(importLineSchema).min(1).max(250),
  })
  .refine(
    (v) => (v.itemGroupId === undefined) !== (v.newGroupName === undefined),
    {
      message: 'Choose a group, or name a new one',
      path: ['itemGroupId'],
    },
  )
export type ImportInput = z.input<typeof importSchema>
