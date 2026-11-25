// /api/collection/import: matching a pasted decklist against the card search
// index, then importing it into a group.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { catalogGroups, catalogProducts } from '../../db/schema.ts'
import type { Db } from '../../db/types.ts'
import { createTestApi } from './harness.ts'

let api: Awaited<ReturnType<typeof createTestApi>>

const preview = async (text: string) =>
  (
    await api.call<any>('POST', '/collection/import/preview', {
      game: 'mtg',
      text,
    })
  ).body
const byName = (lines: any[], name: string) =>
  lines.find((l) => l.name === name)

beforeAll(async () => {
  api = await createTestApi()
  const db = api.db as unknown as Db
  const synced = new Date()
  await db.insert(catalogGroups).values([
    {
      groupId: 2098,
      categoryId: 1,
      name: 'Rivals of Ixalan',
      abbreviation: 'RIX',
      publishedOn: '2018-01-19',
      productsSyncedAt: synced,
    },
    {
      groupId: 2099,
      categoryId: 1,
      name: 'Rivals of Ixalan Promos',
      abbreviation: null,
      publishedOn: '2018-01-19',
      productsSyncedAt: synced,
    },
    {
      groupId: 23020,
      categoryId: 1,
      name: 'Commander Masters',
      abbreviation: 'CMM',
      publishedOn: '2023-08-04',
      productsSyncedAt: synced,
    },
    {
      groupId: 2900,
      categoryId: 1,
      name: 'Commander 2021',
      abbreviation: 'C21',
      publishedOn: '2021-04-23',
      productsSyncedAt: synced,
    },
    {
      groupId: 24000,
      categoryId: 1,
      name: 'Foundations',
      abbreviation: 'FDN',
      publishedOn: '2024-11-15',
      productsSyncedAt: synced,
    },
  ])
  const card = (
    productId: number,
    groupId: number,
    name: string,
    number: string,
  ) => ({
    productId,
    groupId,
    name,
    number,
    categoryId: 1,
    rarity: 'R',
    sealed: false,
  })
  await db
    .insert(catalogProducts)
    .values([
      card(155562, 2098, 'Ghalta, Primal Hunger', '130'),
      card(155942, 2099, 'Ghalta, Primal Hunger (Prerelease)', '130s'),
      card(504125, 23020, 'Ghalta, Primal Hunger', '292'),
      card(504171, 23020, 'Ghalta, Primal Hunger (Foil Etched)', '561'),
      card(240001, 2900, 'Beast Within', '205'),
      card(590001, 24000, 'Forest (280)', '280'),
      card(590002, 24000, 'Forest (281)', '281'),
      card(700001, 23020, 'Craterhoof Behemoth', '286'),
      {
        productId: 999,
        groupId: 23020,
        categoryId: 1,
        name: 'Ghalta, Primal Hunger Deck',
        sealed: true,
      },
    ])
})
afterAll(() => api.close())

describe('matching', () => {
  it('matches by set and number, including basic lands named with their number', async () => {
    const p = await preview(
      '1 Ghalta, Primal Hunger (RIX) 130 *F*\n30 Forest (FDN) 280',
    )
    expect(p.indexed).toBe(true)
    expect(byName(p.lines, 'Ghalta, Primal Hunger')).toMatchObject({
      status: 'matched',
      finish: 'foil',
      match: { productId: 155562, setName: 'Rivals of Ixalan' },
    })
    expect(byName(p.lines, 'Forest')).toMatchObject({
      status: 'matched',
      quantity: 30,
      match: { productId: 590001 },
    })
  })

  it('finds a promo by name and number when its set code does not line up', async () => {
    const p = await preview('1 Ghalta, Primal Hunger (PRIX) 130s')
    expect(p.lines[0]).toMatchObject({
      status: 'guessed',
      match: { productId: 155942 },
    })
  })

  it('picks the etched product for an etched line', async () => {
    const p = await preview(
      '1 Ghalta, Primal Hunger (CMM) 561 *E*\n1 Ghalta, Primal Hunger (CMM) *E*',
    )
    expect(p.lines.map((l: any) => [l.status, l.match?.productId])).toEqual([
      ['matched', 504171],
      ['guessed', 504171],
    ])
  })

  it('uses the only printing for a name, asks when there are several, and reports unknown cards', async () => {
    const p = await preview(
      '1 Beast Within\n1 Ghalta, Primal Hunger\n1 Not A Real Card',
    )
    expect(byName(p.lines, 'Beast Within')).toMatchObject({
      status: 'guessed',
      match: { productId: 240001 },
    })
    const ghalta = byName(p.lines, 'Ghalta, Primal Hunger')
    expect(ghalta.status).toBe('choose')
    // Non-etched printings, newest first; never the sealed deck.
    expect(ghalta.candidates.map((c: any) => c.productId)).toEqual([
      504125, 504171, 155562, 155942,
    ])
    expect(byName(p.lines, 'Not A Real Card').status).toBe('notfound')
  })
})

describe('importing', () => {
  const line = (
    productId: number,
    name: string,
    quantity: number,
    priceCents: number | null,
    extra = {},
  ) => ({
    categoryId: 1,
    groupId: productId === 240001 ? 2900 : productId === 700001 ? 23020 : 2098,
    setName: 'Some Set',
    productId,
    name,
    subType: 'Normal',
    quantity,
    condition: 'Near Mint',
    priceCents,
    ...extra,
  })
  let ghaltaDeck: number
  let otherDeck: number

  it('creates the group and adds every card at market value as already owned', async () => {
    const res = await api.call<any>('POST', '/collection/import', {
      date: '2026-11-25',
      newGroupName: 'Ghalta',
      lines: [
        line(155562, 'Ghalta, Primal Hunger', 1, 500),
        line(240001, 'Beast Within', 1, 150),
      ],
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ added: 2, moved: 0, present: 0 })
    ghaltaDeck = res.body.itemGroupId
    const g = (await api.call<any>('GET', `/groups/${ghaltaDeck}`)).body
    expect(g).toMatchObject({
      name: 'Ghalta',
      cardCount: 2,
      costCents: 650,
      marketCents: 650,
    })
    expect(g.items.every((i: any) => i.basisSource === 'baseline')).toBe(true)
  })

  it('adds nothing when the same list is imported again', async () => {
    const res = await api.call<any>('POST', '/collection/import', {
      date: '2026-11-25',
      itemGroupId: ghaltaDeck,
      lines: [
        line(155562, 'Ghalta, Primal Hunger', 1, 500),
        line(240001, 'Beast Within', 1, 150),
      ],
    })
    expect(res.body).toMatchObject({ added: 0, moved: 0, present: 2 })
  })

  it('gives another deck its own copy instead of taking Ghalta’s, and uses ungrouped copies first', async () => {
    // Three Craterhoofs entered by hand, in no group.
    const hand = await api.call<any>('POST', '/items', {
      kind: 'card',
      name: 'Craterhoof Behemoth',
      quantity: 3,
      card: {
        categoryId: 1,
        groupId: 23020,
        productId: 700001,
        subType: 'Normal',
        setName: 'Commander Masters',
      },
      acquisition: { mode: 'baseline', date: '2026-11-20', valueCents: 12000 },
    })
    const res = await api.call<any>('POST', '/collection/import', {
      date: '2026-11-25',
      newGroupName: 'Other deck',
      lines: [
        line(240001, 'Beast Within', 1, 150), // in Ghalta: left there
        line(700001, 'Craterhoof Behemoth', 1, 4000), // one of the ungrouped three
      ],
    })
    expect(res.body).toMatchObject({ added: 1, moved: 1, present: 0 })
    otherDeck = res.body.itemGroupId
    // The hand-entered row was split: 2 stay ungrouped, 1 moved, cost shared out.
    const left = (await api.call<any>('GET', `/items/${hand.body.id}`)).body
    expect(left).toMatchObject({
      quantity: 2,
      costBasisCents: 8000,
      itemGroup: null,
    })
    const other = (await api.call<any>('GET', `/groups/${otherDeck}`)).body
    expect(
      other.items
        .map((i: any) => [i.name, i.quantity, i.costBasisCents])
        .sort(),
    ).toEqual([
      ['Beast Within', 1, 150],
      ['Craterhoof Behemoth', 1, 4000],
    ])
    // Ghalta still has its Beast Within.
    expect(
      (await api.call<any>('GET', `/groups/${ghaltaDeck}`)).body.cardCount,
    ).toBe(2)
  })

  it('adds everything new when told to ignore existing copies', async () => {
    const res = await api.call<any>('POST', '/collection/import', {
      date: '2026-11-25',
      itemGroupId: otherDeck,
      lines: [
        line(700001, 'Craterhoof Behemoth', 1, 4000, { useExisting: false }),
      ],
    })
    expect(res.body).toMatchObject({ added: 1, moved: 0, present: 0 })
  })

  it('is all or nothing: a card with no price stops the whole import', async () => {
    const before = (await api.call<any[]>('GET', '/items')).body.length
    const res = await api.call<any>('POST', '/collection/import', {
      date: '2026-11-25',
      newGroupName: 'Broken import',
      lines: [
        line(504125, 'Ghalta, Primal Hunger', 1, 900),
        line(504171, 'Ghalta, Primal Hunger', 1, null),
      ],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('no market price')
    expect((await api.call<any[]>('GET', '/items')).body.length).toBe(before)
    const groups = (await api.call<any[]>('GET', '/groups')).body
    expect(groups.map((g) => g.name)).not.toContain('Broken import')
  })

  it('needs exactly one of an existing group or a new name, and a free name', async () => {
    const lines = [line(155562, 'Ghalta, Primal Hunger', 1, 500)]
    expect(
      (
        await api.call('POST', '/collection/import', {
          date: '2026-11-25',
          lines,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api.call('POST', '/collection/import', {
          date: '2026-11-25',
          newGroupName: 'ghalta',
          lines,
        })
      ).status,
    ).toBe(409)
  })
})
