import { describe, expect, it } from 'vitest'
import {
  baselinePostings,
  purchasePostings,
  salePostings,
  splitBasis,
} from '../../lib/collection/accounting.ts'
import { validatePostings } from '../../lib/ledger/postings.ts'

const CARDS = 10
const CHECKING = 1
const OPENING = 4
const GAINS = 20

describe('posting builders', () => {
  it('purchase: Collection up, paying account down', () => {
    const p = purchasePostings(CARDS, CHECKING, 4999)
    expect(p).toEqual([
      { accountId: CARDS, amountCents: 4999 },
      { accountId: CHECKING, amountCents: -4999 },
    ])
    expect(validatePostings(p)).toEqual([])
  })

  it('baseline: Collection up, Opening Balances down', () => {
    const p = baselinePostings(CARDS, OPENING, 25603)
    expect(p[1]).toEqual({ accountId: OPENING, amountCents: -25603 })
    expect(validatePostings(p)).toEqual([])
  })

  const sale = (basisCents: number, proceedsCents: number) =>
    salePostings({
      toAccountId: CHECKING,
      kindAccountId: CARDS,
      gainsAccountId: GAINS,
      basisCents,
      proceedsCents,
    })

  it('sale at a gain credits Realized Gains', () => {
    const p = sale(1000, 15000)
    expect(p).toEqual([
      { accountId: CHECKING, amountCents: 15000 },
      { accountId: CARDS, amountCents: -1000 },
      { accountId: GAINS, amountCents: -14000 },
    ])
    expect(validatePostings(p)).toEqual([])
  })

  it('sale at a loss debits Realized Gains', () => {
    const p = sale(5000, 3000)
    expect(p.find((l) => l.accountId === GAINS)?.amountCents).toBe(2000)
    expect(validatePostings(p)).toEqual([])
  })

  it('leaves out zero lines (break-even, giveaway, zero basis)', () => {
    expect(sale(2500, 2500)).toHaveLength(2)
    const giveaway = sale(2500, 0)
    expect(giveaway.map((l) => l.accountId)).toEqual([CARDS, GAINS])
    expect(validatePostings(giveaway)).toEqual([])
    const free = sale(0, 800)
    expect(free.map((l) => l.accountId)).toEqual([CHECKING, GAINS])
    expect(validatePostings(free)).toEqual([])
  })
})

describe('splitBasis', () => {
  it('prorates and keeps the parts summing exactly', () => {
    expect(splitBasis(1000, 3, 1)).toEqual({ soldCents: 333, keptCents: 667 })
    expect(splitBasis(1000, 3, 2)).toEqual({ soldCents: 667, keptCents: 333 })
    for (const [basis, qty, sell] of [
      [1, 3, 1],
      [99999, 7, 3],
      [0, 4, 2],
    ] as const) {
      const { soldCents, keptCents } = splitBasis(basis, qty, sell)
      expect(soldCents + keptCents).toBe(basis)
    }
  })
})
