// Decklist parsing and the "copies you already own" rule (pure functions).
// The fixtures are written by hand in each deckbuilder's documented export
// format, not taken from real exports.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDecklist, planLine } from '../../lib/collection/decklist.ts'

const fixture = (name: string) =>
  readFileSync(`tests/fixtures/decklists/${name}`, 'utf-8')

describe('parseDecklist', () => {
  it('reads a Moxfield export: set, number, foil and etched', () => {
    const { lines, skipped } = parseDecklist(fixture('moxfield.txt'))
    expect(skipped).toEqual([])
    expect(lines).toEqual([
      {
        lineNo: 1,
        quantity: 1,
        name: 'Ghalta, Primal Hunger',
        setCode: 'RIX',
        number: '130',
        finish: 'foil',
      },
      {
        lineNo: 2,
        quantity: 1,
        name: 'Beast Within',
        setCode: 'C21',
        number: '205',
        finish: 'normal',
      },
      {
        lineNo: 3,
        quantity: 1,
        name: 'Craterhoof Behemoth',
        setCode: 'CMM',
        number: '286',
        finish: 'normal',
      },
      {
        lineNo: 4,
        quantity: 1,
        name: 'Ghalta, Primal Hunger',
        setCode: 'CMM',
        number: '561',
        finish: 'etched',
      },
      {
        lineNo: 5,
        quantity: 1,
        name: 'Sol Ring',
        setCode: 'PLST',
        number: 'C21-263',
        finish: 'normal',
      },
      {
        lineNo: 6,
        quantity: 30,
        name: 'Forest',
        setCode: 'FDN',
        number: '280',
        finish: 'normal',
      },
      // A sideboard card is still a card you own.
      {
        lineNo: 9,
        quantity: 1,
        name: 'Heroic Intervention',
        setCode: 'AER',
        number: '109',
        finish: 'normal',
      },
    ])
  })

  it('reads an Archidekt export: lowercase sets, tags dropped, maybeboard left out, duplicates combined', () => {
    const { lines, skipped } = parseDecklist(fixture('archidekt.txt'))
    expect(
      lines.map((l) => [l.quantity, l.name, l.setCode, l.number, l.finish]),
    ).toEqual([
      [1, 'Ghalta, Primal Hunger', 'RIX', '130', 'foil'],
      [1, 'Beast Within', 'C21', '205', 'normal'],
      [1, 'Craterhoof Behemoth', 'CMM', '286', 'normal'],
      [30, 'Forest', 'FDN', '280', 'normal'],
    ])
    expect(skipped).toEqual([
      {
        lineNo: 4,
        text: '1x Hydroid Krasis (rna) 183 [Maybeboard{noDeck}{noPrice}]',
        reason: 'maybeboard',
      },
    ])
  })

  it('reads an Arena export, including double-faced names', () => {
    const { lines } = parseDecklist(fixture('arena.txt'))
    expect(lines.map((l) => [l.quantity, l.name, l.setCode, l.number])).toEqual(
      [
        [1, 'Ghalta, Primal Hunger', 'RIX', '130'],
        [1, 'Beast Within', 'C21', '205'],
        [1, 'Delver of Secrets // Insectile Aberration', 'ISD', '51'],
        [20, 'Forest', 'FDN', '280'],
      ],
    )
  })

  it('reads plain names: headers and comments skipped, a missing quantity is 1', () => {
    const { lines, skipped } = parseDecklist(fixture('plain.txt'))
    expect(lines.map((l) => [l.quantity, l.name, l.setCode])).toEqual([
      [1, 'Ghalta, Primal Hunger', null],
      [2, 'Craterhoof Behemoth', null],
      [1, 'Sol Ring', null],
    ])
    expect(skipped.map((s) => s.reason)).toEqual(['maybeboard'])
  })

  it('keeps foil and non-foil copies of a card apart', () => {
    const { lines } = parseDecklist(
      '1 Forest (FDN) 280\n1 Forest (FDN) 280 *F*',
    )
    expect(lines.map((l) => l.finish)).toEqual(['normal', 'foil'])
  })

  it('flags an absurd quantity', () => {
    expect(parseDecklist('5000 Forest').skipped[0]?.reason).toBe('quantity')
  })
})

describe('planLine', () => {
  const DECK = 1
  const OTHER = 2

  it('adds everything when nothing is owned', () => {
    expect(planLine(2, [], DECK)).toEqual({
      present: 0,
      fromUngrouped: [],
      add: 2,
      elsewhere: 0,
    })
  })

  it('counts copies already in the deck, so re-importing adds nothing', () => {
    expect(
      planLine(1, [{ itemId: 5, quantity: 1, itemGroupId: DECK }], DECK),
    ).toEqual({
      present: 1,
      fromUngrouped: [],
      add: 0,
      elsewhere: 0,
    })
  })

  it('uses ungrouped copies next, smallest rows first, splitting only the last', () => {
    const owned = [
      { itemId: 7, quantity: 5, itemGroupId: null },
      { itemId: 8, quantity: 1, itemGroupId: null },
      { itemId: 9, quantity: 1, itemGroupId: DECK },
    ]
    expect(planLine(4, owned, DECK)).toEqual({
      present: 1,
      fromUngrouped: [
        { itemId: 8, quantity: 1 },
        { itemId: 7, quantity: 2 },
      ],
      add: 0,
      elsewhere: 0,
    })
  })

  it('never takes copies from another deck: Beast Within in Ghalta stays there', () => {
    expect(
      planLine(1, [{ itemId: 3, quantity: 1, itemGroupId: OTHER }], DECK),
    ).toEqual({ present: 0, fromUngrouped: [], add: 1, elsewhere: 1 })
  })

  it('adds everything new when told not to use existing copies', () => {
    const owned = [
      { itemId: 7, quantity: 2, itemGroupId: null },
      { itemId: 9, quantity: 1, itemGroupId: DECK },
    ]
    expect(planLine(2, owned, DECK, false)).toEqual({
      present: 0,
      fromUngrouped: [],
      add: 2,
      elsewhere: 0,
    })
  })
})
