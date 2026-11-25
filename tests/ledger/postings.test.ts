import { describe, expect, it } from 'vitest'
import {
  postingsToSimple,
  simpleToPostings,
  validatePostings,
} from '../../lib/ledger/postings.ts'

describe('validatePostings', () => {
  it('accepts balanced postings', () => {
    expect(
      validatePostings([
        { accountId: 1, amountCents: 1000 },
        { accountId: 2, amountCents: -600 },
        { accountId: 3, amountCents: -400 },
      ]),
    ).toEqual([])
  })

  it('requires at least two postings', () => {
    expect(
      validatePostings([{ accountId: 1, amountCents: 0 }]).length,
    ).toBeGreaterThan(0)
    expect(validatePostings([])).toContain(
      'A transaction needs at least two postings.',
    )
  })

  it('rejects zero, fractional and unbalanced amounts', () => {
    expect(
      validatePostings([
        { accountId: 1, amountCents: 0 },
        { accountId: 2, amountCents: 0 },
      ]),
    ).toHaveLength(2)
    expect(
      validatePostings([
        { accountId: 1, amountCents: 10.5 },
        { accountId: 2, amountCents: -10.5 },
      ]),
    ).toHaveLength(2)
    expect(
      validatePostings([
        { accountId: 1, amountCents: 1000 },
        { accountId: 2, amountCents: -999 },
      ]),
    ).toEqual(["Postings must sum to zero (they're off by 1 cents)."])
  })
})

describe('simple form ↔ postings', () => {
  const groceries = { amountCents: 4250, fromAccountId: 1, toAccountId: 7 }

  it('debits "to" and credits "from"', () => {
    expect(simpleToPostings(groceries)).toEqual([
      { accountId: 7, amountCents: 4250 },
      { accountId: 1, amountCents: -4250 },
    ])
  })

  it('round-trips, regardless of posting order', () => {
    const postings = simpleToPostings(groceries)
    expect(postingsToSimple(postings)).toEqual(groceries)
    expect(postingsToSimple([...postings].reverse())).toEqual(groceries)
  })

  it('returns null for anything the simple form cannot show', () => {
    expect(
      postingsToSimple([
        { accountId: 1, amountCents: 1000 },
        { accountId: 2, amountCents: -600 },
        { accountId: 3, amountCents: -400 },
      ]),
    ).toBeNull()
    expect(
      postingsToSimple([
        { accountId: 1, amountCents: 1000, memo: 'note' },
        { accountId: 2, amountCents: -1000 },
      ]),
    ).toBeNull()
  })
})
