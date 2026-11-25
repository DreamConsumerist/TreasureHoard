// /api/recurring: templates, the catch-up, and the Dashboard's due list and
// "Owed to you" card. Runs the real routes on PGlite with the real migrations.

import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { MAX_PER_CATCH_UP } from '../../lib/api/ledger/recurring.ts'
import { createTestApi } from './harness.ts'

let api: Awaited<ReturnType<typeof createTestApi>>
const acct: Record<string, number> = {}

const catchUp = async (today: string) =>
  (
    await api.call<{ created: number }>('POST', '/recurring/catch-up', {
      today,
    })
  ).body.created
const pendingFor = async (templateId: number) =>
  (
    await api.call<any>('GET', '/transactions?status=pending&limit=200')
  ).body.items
    .filter((t: any) => t.recurringTemplateId === templateId)
    .sort((a: any, b: any) => a.date.localeCompare(b.date))
const dashboard = async (today: string) =>
  (await api.call<any>('GET', `/dashboard?today=${today}`)).body

beforeAll(async () => {
  api = await createTestApi()
  const accounts = (await api.call<any[]>('GET', '/accounts')).body
  for (const a of accounts) acct[a.name] = a.id
  const roommate = await api.call('POST', '/accounts', {
    name: 'Roommate',
    type: 'asset',
    parentId: acct['Owed to me'],
  })
  expect(roommate.status).toBe(201)
  acct.Roommate = roommate.body.id
})
afterAll(() => api.close())

const electric = () => ({
  description: 'Electric',
  frequency: 'month',
  interval: 1,
  startDate: '2027-01-31',
  variable: true,
  postings: [
    { accountId: acct.Checking!, amountCents: -12000 },
    { accountId: acct.Utilities!, amountCents: 6000 },
    { accountId: acct.Roommate!, amountCents: 6000 },
  ],
})
const paycheck = () => ({
  description: 'Paycheck',
  frequency: 'month',
  startDate: '2027-01-01',
  postings: [
    { accountId: acct.Checking!, amountCents: 300000 },
    { accountId: acct.Salary!, amountCents: -300000 },
  ],
})

describe('the Owed to me account', () => {
  it('exists, is protected, and takes sub-accounts', async () => {
    const accounts = (await api.call<any[]>('GET', '/accounts')).body
    const owed = accounts.find((a) => a.name === 'Owed to me')
    expect(owed).toMatchObject({ type: 'asset', systemKey: 'receivables' })
    expect((await api.call('DELETE', `/accounts/${owed.id}`)).status).toBe(409)
  })
})

describe('templates', () => {
  it('rejects unbalanced postings and an end before the start', async () => {
    const bad = electric()
    bad.postings[0]!.amountCents = -11000
    expect((await api.call('POST', '/recurring', bad)).status).toBe(400)
    expect(
      (
        await api.call('POST', '/recurring', {
          ...electric(),
          endDate: '2026-12-01',
        })
      ).status,
    ).toBe(400)
  })

  it('creates a template and previews its next dates', async () => {
    const res = await api.call<any>('POST', '/recurring', electric())
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      description: 'Electric',
      variable: true,
      nextDue: '2027-01-31',
      upcoming: ['2027-01-31', '2027-02-28', '2027-03-31'],
      pendingCount: 0,
    })
  })
})

describe('catch-up', () => {
  let electricId: number

  it('creates only due occurrences, as pending, on their dates', async () => {
    electricId = (await api.call<any[]>('GET', '/recurring')).body[0].id
    expect(await catchUp('2027-01-30')).toBe(0)
    expect(await catchUp('2027-03-01')).toBe(2)
    const made = await pendingFor(electricId)
    expect(made.map((t: any) => [t.date, t.status, t.description])).toEqual([
      ['2027-01-31', 'pending', 'Electric'],
      ['2027-02-28', 'pending', 'Electric'],
    ])
    expect(made[0].postings.map((p: any) => p.amountCents)).toEqual([
      -12000, 6000, 6000,
    ])
  })

  it('creates nothing new when run again', async () => {
    expect(await catchUp('2027-03-01')).toBe(0)
    expect(await pendingFor(electricId)).toHaveLength(2)
  })

  it('lists due items on the dashboard with the coming week', async () => {
    const d = await dashboard('2027-03-28')
    expect(
      d.recurring.due.map((o: any) => [o.transaction.date, o.variable]),
    ).toEqual([
      ['2027-01-31', true],
      ['2027-02-28', true],
    ])
    expect(d.recurring.upcoming).toEqual([
      {
        templateId: electricId,
        description: 'Electric',
        date: '2027-03-31',
        amountCents: 12000,
        variable: true,
      },
    ])
  })

  it('estimates a variable bill from the last confirmed total', async () => {
    const [jan] = await pendingFor(electricId)
    const confirmed = await api.call('PUT', `/transactions/${jan.id}`, {
      date: jan.date,
      description: jan.description,
      status: 'cleared',
      postings: [
        { accountId: acct.Checking, amountCents: -13841 },
        { accountId: acct.Utilities, amountCents: 6921 },
        { accountId: acct.Roommate, amountCents: 6920 },
      ],
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.recurringTemplateId).toBe(electricId) // link kept
    expect(await catchUp('2027-03-31')).toBe(1)
    const mar = (await pendingFor(electricId)).at(-1)
    expect(mar.date).toBe('2027-03-31')
    expect(mar.postings.map((p: any) => p.amountCents)).toEqual([
      -13841, 6921, 6920,
    ])
  })

  it('does not re-create a skipped occurrence', async () => {
    const feb = (await pendingFor(electricId)).find(
      (t: any) => t.date === '2027-02-28',
    )
    expect((await api.call('DELETE', `/transactions/${feb.id}`)).status).toBe(
      200,
    )
    expect(await catchUp('2027-03-31')).toBe(0)
  })

  it('shows who owes what, and the last payment', async () => {
    // Confirmed Jan bill: the roommate owes $69.20. The Mar estimate is pending
    // but counts too, like every pending transaction: +$69.20.
    let d = await dashboard('2027-04-01')
    expect(d.owedToYou).toEqual([
      {
        accountId: acct.Roommate,
        name: 'Roommate',
        balanceCents: 13840,
        lastPaymentDate: null,
      },
    ])
    await api.call('POST', '/transactions', {
      date: '2027-04-02',
      description: 'Roommate paid',
      postings: [
        { accountId: acct.Roommate, amountCents: -6920 },
        { accountId: acct.Checking, amountCents: 6920 },
      ],
    })
    d = await dashboard('2027-04-03')
    expect(d.owedToYou[0]).toMatchObject({
      balanceCents: 6920,
      lastPaymentDate: '2027-04-02',
    })
  })

  it('leaves money owed to you out of cash', async () => {
    const d = await dashboard('2027-04-03')
    const accounts = (await api.call<any[]>('GET', '/accounts')).body
    const bal = (name: string) =>
      accounts.find((a) => a.name === name).balanceCents
    expect(d.cashCents).toBe(bal('Checking') + bal('Savings'))
  })
})

describe('editing', () => {
  let payId: number

  it('changes future occurrences only (a raise)', async () => {
    payId = (await api.call<any>('POST', '/recurring', paycheck())).body.id
    expect(await catchUp('2027-02-15')).toBe(2) // Jan 1, Feb 1
    const raised = paycheck()
    raised.postings[0]!.amountCents = 320000
    raised.postings[1]!.amountCents = -320000
    expect((await api.call('PUT', `/recurring/${payId}`, raised)).status).toBe(
      200,
    )
    expect(await catchUp('2027-03-01')).toBe(1)
    const amounts = (await pendingFor(payId)).map(
      (t: any) => t.postings[0].amountCents,
    )
    expect(amounts).toEqual([300000, 300000, 320000])
  })

  it('never re-creates past occurrences after a schedule change', async () => {
    // Move payday to the 15th, starting back in January.
    const res = await api.call<any>('PUT', `/recurring/${payId}`, {
      ...paycheck(),
      startDate: '2027-01-15',
    })
    expect(res.body.nextDue).toBe('2027-03-15') // after the Mar 1 one
    expect(await catchUp('2027-03-20')).toBe(1)
    expect((await pendingFor(payId)).map((t: any) => t.date)).toEqual([
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
      '2027-03-15',
    ])
  })

  it('stops while paused and at the end date', async () => {
    await api.call('PUT', `/recurring/${payId}`, {
      ...paycheck(),
      startDate: '2027-01-15',
      active: false,
    })
    const before = (await pendingFor(payId)).length
    await catchUp('2027-05-20') // Electric (still active) catches up here
    expect(await pendingFor(payId)).toHaveLength(before)
    const res = await api.call<any>('PUT', `/recurring/${payId}`, {
      ...paycheck(),
      startDate: '2027-01-15',
      endDate: '2027-04-30',
    })
    expect(res.body.upcoming).toEqual(['2027-04-15'])
    expect(await catchUp('2027-05-20')).toBe(1)
  })

  it('keeps transactions when the template is deleted', async () => {
    const before = (await pendingFor(payId)).length
    expect((await api.call('DELETE', `/recurring/${payId}`)).status).toBe(200)
    const all = (
      await api.call<any>('GET', '/transactions?q=Paycheck&limit=200')
    ).body.items
    expect(all).toHaveLength(before)
    expect(all.every((t: any) => t.recurringTemplateId === null)).toBe(true)
  })
})

describe('limits', () => {
  it(`creates at most ${MAX_PER_CATCH_UP} occurrences per template per catch-up`, async () => {
    const weekly = await api.call<any>('POST', '/recurring', {
      ...paycheck(),
      description: 'Weekly allowance',
      frequency: 'week',
      startDate: '2020-01-06',
    })
    expect(await catchUp('2027-01-01')).toBe(MAX_PER_CATCH_UP)
    expect(await catchUp('2027-01-01')).toBe(MAX_PER_CATCH_UP)
    await api.call('DELETE', `/recurring/${weekly.body.id}`)
  })

  it('refuses Collection accounts', async () => {
    const accounts = (await api.call<any[]>('GET', '/accounts')).body
    const cards = accounts.find((a) => a.systemKey === 'collection_card')
    const res = await api.call('POST', '/recurring', {
      ...paycheck(),
      postings: [
        { accountId: cards.id, amountCents: 100 },
        { accountId: acct.Checking, amountCents: -100 },
      ],
    })
    expect(res.status).toBe(400)
  })
})
