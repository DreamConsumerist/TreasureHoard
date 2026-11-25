import { describe, expect, it } from 'vitest'
import {
  centsToInput,
  formatMoney,
  parseMoney,
} from '../../lib/ledger/money.ts'

describe('parseMoney', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['0.1', 10],
    ['.99', 99],
    ['1,000', 100000],
    ['$1,234.56', 123456],
    ['  7.00 ', 700],
    ['-5', -500],
    ['-0.01', -1],
    ['1.15', 115], // 1.15 * 100 in floats is 114.999…
    ['0', 0],
    ['-0', 0],
  ])('parses %j as %i cents', (input, cents) => {
    expect(parseMoney(input)).toBe(cents)
  })

  it.each(['', '-', '.', '-.', '1.234', 'abc', '1.2.3', '--5', '5-', '1e3'])(
    'rejects %j',
    (input) => {
      expect(parseMoney(input)).toBeNull()
    },
  )
})

describe('formatMoney', () => {
  it('formats with currency symbol, separators and two decimals', () => {
    expect(formatMoney(123456)).toBe('$1,234.56')
    expect(formatMoney(5)).toBe('$0.05')
    expect(formatMoney(-500)).toBe('-$5.00')
  })
})

describe('centsToInput', () => {
  it('round-trips through parseMoney', () => {
    for (const cents of [0, 1, 99, 100, 123456, -5, -123456]) {
      expect(parseMoney(centsToInput(cents))).toBe(cents)
    }
  })
})
