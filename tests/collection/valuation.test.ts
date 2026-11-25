import { describe, expect, it } from 'vitest'
import {
  marketNetWorthCents,
  marketValueCents,
  weekChangeCents,
} from '../../lib/collection/valuation.ts'

const item = (unit: number | null, weekAgo: number | null, qty = 2) => ({
  quantity: qty,
  costBasisCents: 1000,
  unitPriceCents: unit,
  weekAgoPriceCents: weekAgo,
})

describe('market value', () => {
  it('is unit price × quantity', () => {
    expect(marketValueCents(item(750, null))).toBe(1500)
  })

  it('counts a never-priced item at cost', () => {
    expect(marketValueCents(item(null, null))).toBe(1000)
  })

  it('gives the 7-day change for the whole row, or null without a week-old price', () => {
    expect(weekChangeCents(item(750, 500))).toBe(500)
    expect(weekChangeCents(item(400, 500))).toBe(-200)
    expect(weekChangeCents(item(750, null))).toBeNull()
    expect(weekChangeCents(item(null, 500))).toBeNull()
  })

  it('swaps the collection from cost to market in net worth', () => {
    // Book 10,000 includes the collection at 3,000; it's worth 4,500.
    expect(marketNetWorthCents(10_000, 3_000, 4_500)).toBe(11_500)
  })
})
