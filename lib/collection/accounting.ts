// How collection events become ledger postings (asset-at-cost accounting).
// Pure functions: the API decides which accounts to use, these decide amounts
// and signs. Positive = debit, negative = credit, as everywhere in the ledger.

import type { PostingInput } from '../ledger/postings.ts'

export const ITEM_KINDS = ['card', 'sealed', 'game', 'hardware'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

/** system_key of the Collection sub-account each kind books into. */
export const KIND_ACCOUNT_KEY: Record<ItemKind, string> = {
  card: 'collection_card',
  sealed: 'collection_sealed',
  game: 'collection_game',
  hardware: 'collection_hardware',
}

/** Bought: the item's cost moves from the paying account into the Collection. */
export function purchasePostings(
  kindAccountId: number,
  fromAccountId: number,
  costCents: number,
): PostingInput[] {
  return [
    { accountId: kindAccountId, amountCents: costCents },
    { accountId: fromAccountId, amountCents: -costCents },
  ]
}

/** Already owned: the baseline value enters the Collection from Opening Balances. */
export function baselinePostings(
  kindAccountId: number,
  openingAccountId: number,
  valueCents: number,
): PostingInput[] {
  return [
    { accountId: kindAccountId, amountCents: valueCents },
    { accountId: openingAccountId, amountCents: -valueCents },
  ]
}

/**
 * Sold: proceeds arrive in the receiving account, the item's cost basis leaves
 * the Collection, and the difference is a realized gain (credit) or loss
 * (debit). Zero lines are left out, e.g. selling at exactly cost, giving an
 * item away (no proceeds), or selling something with a $0 basis.
 */
export function salePostings(p: {
  toAccountId: number
  kindAccountId: number
  gainsAccountId: number
  basisCents: number
  proceedsCents: number
}): PostingInput[] {
  const gain = p.proceedsCents - p.basisCents
  const lines: PostingInput[] = [
    { accountId: p.toAccountId, amountCents: p.proceedsCents },
    { accountId: p.kindAccountId, amountCents: -p.basisCents },
    { accountId: p.gainsAccountId, amountCents: -gain },
  ]
  return lines.filter((l) => l.amountCents !== 0)
}

/**
 * Splits a row's cost basis for a partial sale: the sold part gets its
 * prorated share (rounded), the remainder stays with what's kept, so the two
 * always sum to the original exactly.
 */
export function splitBasis(
  basisCents: number,
  quantity: number,
  sellQuantity: number,
): { soldCents: number; keptCents: number } {
  const soldCents = Math.round((basisCents * sellQuantity) / quantity)
  return { soldCents, keptCents: basisCents - soldCents }
}
