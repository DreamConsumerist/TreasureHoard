// Display helpers for collection items.

import type { ItemKind } from '../../lib/collection/accounting.ts'
import type { ItemOut } from '../../lib/collection/types.ts'

export const KIND_LABELS: Record<ItemKind, string> = {
  card: 'Cards',
  sealed: 'Sealed',
  game: 'Games',
  hardware: 'Hardware',
}

export const KIND_SINGULAR: Record<ItemKind, string> = {
  card: 'Card',
  sealed: 'Sealed product',
  game: 'Game',
  hardware: 'Console / accessory',
}

export const VARIANT_LABELS = {
  loose: 'Loose',
  cib: 'Complete in box',
  new: 'New / sealed',
} as const

export const GAME_LABELS = {
  mtg: 'Magic: The Gathering',
  onepiece: 'One Piece',
  riftbound: 'Riftbound',
} as const

/** Usual condition grades, per kind. Stored as plain text, so anything else still works. */
export const CONDITIONS: Record<ItemKind, string[]> = {
  card: [
    'Near Mint',
    'Lightly Played',
    'Moderately Played',
    'Heavily Played',
    'Damaged',
  ],
  sealed: ['Sealed', 'Damaged packaging', 'Opened'],
  game: ['Loose', 'Complete in box', 'New / sealed', 'Disc / cart only'],
  hardware: ['Excellent', 'Good', 'Fair', 'For parts'],
}

/** Latest known value of the whole row, or null if never priced. */
export const itemValue = (item: ItemOut): number | null =>
  item.unitPriceCents === null ? null : item.unitPriceCents * item.quantity

/** Unrealized gain (owned) or realized gain (sold), or null if unknown. */
export function itemGain(item: ItemOut): number | null {
  if (item.soldDate !== null) {
    return item.saleProceedsCents === null
      ? null
      : item.saleProceedsCents - item.costBasisCents
  }
  const value = itemValue(item)
  return value === null ? null : value - item.costBasisCents
}

/** A one-line description: set and number for cards, platform and variant for games. */
export function itemSubtitle(item: ItemOut): string {
  if (item.card) {
    return [
      item.card.setName,
      item.card.number,
      item.card.subType && item.card.subType !== 'Normal'
        ? item.card.subType
        : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (item.game)
    return `${item.game.platform} · ${VARIANT_LABELS[item.game.variant]}`
  return ''
}
