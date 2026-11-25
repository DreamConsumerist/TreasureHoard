// The recurring date rules and the bill-rescaling rule (pure functions).

import { describe, expect, it } from 'vitest'
import {
  describeSchedule,
  firstIndexAfter,
  occurrenceDate,
  occurrencesFrom,
  rescaleToTotal,
  type Schedule,
} from '../../lib/ledger/recurring.ts'

const monthly = (startDate: string, interval = 1): Schedule => ({
  frequency: 'month',
  interval,
  startDate,
})

describe('occurrence dates', () => {
  it('keeps a bill due on the 31st on the last day of short months, and back on the 31st after', () => {
    expect(occurrencesFrom(monthly('2027-01-31'), 0, 5)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
      '2027-05-31',
    ])
  })

  it('uses Feb 29 in a leap year', () => {
    expect(occurrenceDate(monthly('2027-12-30'), 2)).toBe('2028-02-29')
  })

  it('crosses the year boundary', () => {
    expect(occurrencesFrom(monthly('2026-11-15', 2), 0, 3)).toEqual([
      '2026-11-15',
      '2027-01-15',
      '2027-03-15',
    ])
  })

  it('steps weekly and every two weeks', () => {
    const weekly: Schedule = {
      frequency: 'week',
      interval: 1,
      startDate: '2026-12-25',
    }
    expect(occurrencesFrom(weekly, 0, 3)).toEqual([
      '2026-12-25',
      '2027-01-01',
      '2027-01-08',
    ])
    expect(occurrenceDate({ ...weekly, interval: 2 }, 3)).toBe('2027-02-05')
  })

  it('moves a Feb 29 yearly date to Feb 28 in other years', () => {
    const yearly: Schedule = {
      frequency: 'year',
      interval: 1,
      startDate: '2028-02-29',
    }
    expect(occurrencesFrom(yearly, 0, 2)).toEqual(['2028-02-29', '2029-02-28'])
    expect(occurrenceDate(yearly, 4)).toBe('2032-02-29')
  })

  it('stops at the end date', () => {
    expect(
      occurrencesFrom(
        { ...monthly('2027-01-10'), endDate: '2027-03-10' },
        0,
        10,
      ),
    ).toEqual(['2027-01-10', '2027-02-10', '2027-03-10'])
  })

  it('finds the first occurrence after a date', () => {
    expect(firstIndexAfter(monthly('2027-01-15'), '2027-03-15')).toBe(3)
    expect(firstIndexAfter(monthly('2027-01-15'), '2026-12-31')).toBe(0)
  })

  it('describes schedules in words', () => {
    expect(describeSchedule(monthly('2027-01-15'))).toBe('Monthly on the 15th')
    expect(describeSchedule(monthly('2027-01-31'))).toBe(
      "Monthly on the 31st (or the month's last day)",
    )
    expect(
      describeSchedule({
        frequency: 'week',
        interval: 2,
        startDate: '2026-12-25',
      }),
    ).toBe('Every 2 weeks on Friday')
    expect(
      describeSchedule({
        frequency: 'year',
        interval: 1,
        startDate: '2027-03-03',
      }),
    ).toBe('Yearly on Mar 3')
  })
})

describe('rescaling a bill to its real total', () => {
  // Checking pays, half is yours, half is the roommate's.
  const bill = [
    { accountId: 1, amountCents: -12000 },
    { accountId: 2, amountCents: 6000 },
    { accountId: 3, amountCents: 6000 },
  ]

  it('keeps a 50/50 split exact on an odd cent', () => {
    expect(rescaleToTotal(bill, 13841)).toEqual([
      { accountId: 1, amountCents: -13841 },
      { accountId: 2, amountCents: 6921 },
      { accountId: 3, amountCents: 6920 },
    ])
  })

  it('keeps uneven proportions and always balances', () => {
    const third = [
      { accountId: 1, amountCents: -9000 },
      { accountId: 2, amountCents: 3000 },
      { accountId: 3, amountCents: 6000 },
    ]
    const out = rescaleToTotal(third, 10000)!
    expect(out.map((p) => p.amountCents)).toEqual([-10000, 3333, 6667])
    expect(out.reduce((s, p) => s + p.amountCents, 0)).toBe(0)
  })

  it('handles a simple two-line transaction', () => {
    expect(
      rescaleToTotal(
        [
          { accountId: 5, amountCents: 250000 },
          { accountId: 6, amountCents: -250000 },
        ],
        260000,
      ),
    ).toEqual([
      { accountId: 5, amountCents: 260000 },
      { accountId: 6, amountCents: -260000 },
    ])
  })

  it('gives up when there is no single paying line, or the total is not positive', () => {
    const twoEach = [
      { accountId: 1, amountCents: -100 },
      { accountId: 2, amountCents: -100 },
      { accountId: 3, amountCents: 100 },
      { accountId: 4, amountCents: 100 },
    ]
    expect(rescaleToTotal(twoEach, 300)).toBeNull()
    expect(rescaleToTotal(bill, 0)).toBeNull()
  })

  it('gives up when a line would round to zero', () => {
    expect(
      rescaleToTotal(
        [
          { accountId: 1, amountCents: -10001 },
          { accountId: 2, amountCents: 10000 },
          { accountId: 3, amountCents: 1 },
        ],
        100,
      ),
    ).toBeNull()
  })

  it('keeps memos and other fields', () => {
    const out = rescaleToTotal(
      [
        { accountId: 1, amountCents: -200, memo: 'card' },
        { accountId: 2, amountCents: 200, memo: null },
      ],
      300,
    )
    expect(out?.[0]).toEqual({ accountId: 1, amountCents: -300, memo: 'card' })
  })
})
