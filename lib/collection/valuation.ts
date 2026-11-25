// Market value rules, shared by the API (dashboard) and the frontend.
// Market value lives only in price snapshots; the ledger stays at cost.

export interface Valued {
  quantity: number
  costBasisCents: number
  /** Latest known price for one unit, or null if never priced. */
  unitPriceCents: number | null
  /** Unit price from at least 7 days before the latest one, or null if none yet. */
  weekAgoPriceCents: number | null
}

/**
 * Market value of the whole row. An item that has never been priced counts at
 * its cost, so adding something unlisted doesn't make net worth drop.
 */
export function marketValueCents(item: Valued): number {
  return item.unitPriceCents === null
    ? item.costBasisCents
    : item.unitPriceCents * item.quantity
}

/** Change in the row's value over the last 7 days, or null if there's no week-old price. */
export function weekChangeCents(item: Valued): number | null {
  if (item.unitPriceCents === null || item.weekAgoPriceCents === null)
    return null
  return (item.unitPriceCents - item.weekAgoPriceCents) * item.quantity
}

/** Book net worth with the collection swapped from cost to market value. */
export function marketNetWorthCents(
  bookNetWorthCents: number,
  collectionCostCents: number,
  collectionMarketCents: number,
): number {
  return bookNetWorthCents - collectionCostCents + collectionMarketCents
}
