// Which price history an item reads from. Snapshots are keyed by product, not
// item, so two copies of the same card share one history.

export interface PriceKey {
  source: 'tcgcsv' | 'pricecharting' | 'manual'
  externalId: string
  variant: string
}

export function priceKeyFor(item: {
  id: number
  card: { productId: number; subType: string | null } | null
  game: { url: string | null; variant: string } | null
}): PriceKey {
  if (item.card) {
    return {
      source: 'tcgcsv',
      externalId: String(item.card.productId),
      variant: item.card.subType ?? '',
    }
  }
  if (item.game?.url) {
    return {
      source: 'pricecharting',
      externalId: new URL(item.game.url).pathname,
      variant: item.game.variant,
    }
  }
  return { source: 'manual', externalId: `item:${item.id}`, variant: '' }
}

export const priceKeyString = (k: PriceKey) =>
  `${k.source}|${k.externalId}|${k.variant}`
