import { describe, expect, it } from 'vitest'
import { isDebitNormal, toNatural } from '../../lib/ledger/sign.ts'
import {
  buildAccountTree,
  flattenTree,
  type AccountRow,
} from '../../lib/ledger/tree.ts'

describe('natural sign', () => {
  it('keeps debit-normal types and flips credit-normal ones', () => {
    expect(isDebitNormal('asset')).toBe(true)
    expect(isDebitNormal('expense')).toBe(true)
    expect(toNatural(-42000, 'liability')).toBe(42000) // $420 owed
    expect(toNatural(-300000, 'income')).toBe(300000) // income earned
    expect(toNatural(-100, 'equity')).toBe(100)
    expect(toNatural(5000, 'asset')).toBe(5000)
    expect(toNatural(5000, 'expense')).toBe(5000)
  })
})

const row = (
  id: number,
  name: string,
  parentId: number | null,
  balanceCents: number,
): AccountRow => ({
  id,
  name,
  type: 'asset',
  parentId,
  systemKey: null,
  archived: false,
  balanceCents,
  clearedBalanceCents: balanceCents,
  openingBalanceCents: null,
  openingDate: null,
})

describe('buildAccountTree', () => {
  const rows = [
    row(1, 'Collection', null, 0),
    row(2, 'Games', 1, 3000),
    row(3, 'Cards', 1, 5000),
    row(4, 'Checking', null, 100000),
    row(5, 'Foils', 3, 200),
  ]

  it('nests children, sorts by name and rolls up balances', () => {
    const tree = buildAccountTree(rows)
    expect(tree.map((n) => n.name)).toEqual(['Checking', 'Collection'])
    const collection = tree[1]!
    expect(collection.children.map((n) => n.name)).toEqual(['Cards', 'Games'])
    expect(collection.totalCents).toBe(8200)
    expect(collection.children[0]!.totalCents).toBe(5200)
  })

  it('builds full paths and depths, flattening depth-first', () => {
    const flat = flattenTree(buildAccountTree(rows))
    expect(flat.map((n) => `${n.depth}:${n.path}`)).toEqual([
      '0:Checking',
      '0:Collection',
      '1:Collection: Cards',
      '2:Collection: Cards: Foils',
      '1:Collection: Games',
    ])
  })
})
