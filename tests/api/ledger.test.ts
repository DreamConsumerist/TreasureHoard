// Integration tests: real routes, real SQL, real migrations (incl. the balance
// trigger), on an in-memory PGlite database shared across this file.

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApi } from './harness.ts'

let api: Awaited<ReturnType<typeof createTestApi>>
const ids: Record<string, number> = {}

beforeAll(async () => {
  api = await createTestApi()
  const { body } = await api.call<{ id: number; name: string }[]>(
    'GET',
    '/accounts',
  )
  for (const a of body) ids[a.name] = a.id
})
afterAll(() => api.close())

const txn = (
  date: string,
  description: string,
  postings: [number, number][],
  extra = {},
) => ({
  date,
  description,
  postings: postings.map(([accountId, amountCents]) => ({
    accountId,
    amountCents,
  })),
  ...extra,
})

describe('auth', () => {
  it('rejects requests without a session', async () => {
    const res = await api.app.request('/api/accounts')
    expect(res.status).toBe(401)
  })
})

describe('accounts', () => {
  it('has the seeded starter chart', () => {
    for (const name of [
      'Checking',
      'Savings',
      'Credit Card',
      'Opening Balances',
      'Groceries',
    ]) {
      expect(ids[name]).toBeTypeOf('number')
    }
  })

  it('creates nested accounts and enforces the parent type rule', async () => {
    const created = await api.call('POST', '/accounts', {
      name: 'Produce',
      type: 'expense',
      parentId: ids.Groceries,
    })
    expect(created.status).toBe(201)
    ids.Produce = created.body.id

    const wrongType = await api.call('POST', '/accounts', {
      name: 'Bad',
      type: 'asset',
      parentId: ids.Groceries,
    })
    expect(wrongType.status).toBe(400)

    const duplicate = await api.call('POST', '/accounts', {
      name: 'Checking',
      type: 'asset',
    })
    expect(duplicate.status).toBe(409)
  })

  it('refuses to move an account under its own descendant', async () => {
    const res = await api.call('PATCH', `/accounts/${ids.Groceries}`, {
      parentId: ids.Produce,
    })
    expect(res.status).toBe(400)
  })

  it('creates an opening balance as a hidden opening transaction, in natural sign', async () => {
    const bank = await api.call('POST', '/accounts', {
      name: 'Brokerage Cash',
      type: 'asset',
      openingBalanceCents: 250000,
      openingDate: '2026-11-01',
    })
    const card = await api.call('POST', '/accounts', {
      name: 'Store Card',
      type: 'liability',
      openingBalanceCents: 42000, // $420 owed
      openingDate: '2026-11-01',
    })
    ids['Brokerage Cash'] = bank.body.id
    ids['Store Card'] = card.body.id

    const { body: accounts } = await api.call<any[]>('GET', '/accounts')
    const balance = (id: number) =>
      accounts.find((a) => a.id === id).balanceCents
    expect(balance(ids['Brokerage Cash']!)).toBe(250000)
    expect(balance(ids['Store Card']!)).toBe(-42000) // stored as a credit
    expect(balance(ids['Opening Balances']!)).toBe(-250000 + 42000)

    const hidden = await api.call(
      'GET',
      `/transactions?accountId=${ids['Brokerage Cash']}`,
    )
    expect(hidden.body.items).toHaveLength(0)
    const shown = await api.call(
      'GET',
      `/transactions?accountId=${ids['Brokerage Cash']}&includeOpening=true`,
    )
    expect(shown.body.items).toHaveLength(1)
    expect(shown.body.items[0].kind).toBe('opening')
  })

  it('sets, changes and removes a seeded account’s opening balance via PATCH', async () => {
    const credit = ids['Credit Card']!
    const get = async () =>
      ((await api.call<any[]>('GET', '/accounts')).body as any[]).find(
        (a) => a.id === credit,
      )
    const openingTxns = async () =>
      (
        await api.call(
          'GET',
          `/transactions?accountId=${credit}&includeOpening=true`,
        )
      ).body.items.filter((t: any) => t.kind === 'opening')

    // Set: $300 owed on a seeded card that has no opening entry yet.
    expect(
      (
        await api.call('PATCH', `/accounts/${credit}`, {
          openingBalanceCents: 30000,
          openingDate: '2026-11-01',
        })
      ).status,
    ).toBe(200)
    let acct = await get()
    expect(acct.openingBalanceCents).toBe(-30000) // stored as a credit
    expect(acct.openingDate).toBe('2026-11-01')
    expect(acct.balanceCents).toBe(-30000)

    // Change: amount and date update the same entry (no second one appears).
    await api.call('PATCH', `/accounts/${credit}`, {
      openingBalanceCents: 31250,
      openingDate: '2026-11-02',
    })
    acct = await get()
    expect(acct.openingBalanceCents).toBe(-31250)
    expect(acct.openingDate).toBe('2026-11-02')
    expect(await openingTxns()).toHaveLength(1)

    // Rename: the opening entry's description follows.
    await api.call('PATCH', `/accounts/${credit}`, { name: 'Visa' })
    expect((await openingTxns())[0].description).toBe('Opening balance: Visa')

    // Remove: 0 deletes the entry and the balance returns to zero.
    await api.call('PATCH', `/accounts/${credit}`, { openingBalanceCents: 0 })
    acct = await get()
    expect(acct.openingBalanceCents).toBeNull()
    expect(acct.balanceCents).toBe(0)
    expect(await openingTxns()).toHaveLength(0)

    // Opening Balances itself can't have one.
    expect(
      (
        await api.call('PATCH', `/accounts/${ids['Opening Balances']}`, {
          openingBalanceCents: 100,
        })
      ).status,
    ).toBe(400)
    await api.call('PATCH', `/accounts/${credit}`, { name: 'Credit Card' })
  })

  it('only deletes unused, childless, non-system accounts', async () => {
    expect(
      (await api.call('DELETE', `/accounts/${ids['Opening Balances']}`)).status,
    ).toBe(409)
    expect(
      (await api.call('DELETE', `/accounts/${ids.Groceries}`)).status,
    ).toBe(409) // has child
    expect(
      (await api.call('DELETE', `/accounts/${ids['Brokerage Cash']}`)).status,
    ).toBe(409) // used
    expect((await api.call('DELETE', `/accounts/${ids.Produce}`)).status).toBe(
      200,
    )
  })
})

describe('transactions', () => {
  it('creates a balanced transaction and rejects an unbalanced one', async () => {
    const ok = await api.call(
      'POST',
      '/transactions',
      txn('2026-11-03', 'Kroger', [
        [ids.Groceries!, 4250],
        [ids.Checking!, -4250],
      ]),
    )
    expect(ok.status).toBe(201)
    expect(ok.body.postings).toHaveLength(2)

    const bad = await api.call(
      'POST',
      '/transactions',
      txn('2026-11-03', 'Broken', [
        [ids.Groceries!, 4250],
        [ids.Checking!, -4000],
      ]),
    )
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/sum to zero/)
  })

  it('has a database backstop: an unbalanced insert that bypasses the API fails at commit', async () => {
    const attempt = api.db.transaction(async (tx) => {
      const result = await tx.execute(
        sql`insert into transactions (date, description) values ('2026-11-04', 'raw') returning id`,
      )
      const id = (result as unknown as { rows: { id: number }[] }).rows[0]!.id
      await tx.execute(
        sql`insert into postings (transaction_id, account_id, amount_cents) values (${id}, ${ids.Checking}, 100), (${id}, ${ids.Savings}, -99)`,
      )
    })
    await expect(attempt).rejects.toThrow(
      /is unbalanced: postings sum to 1 cents/,
    )
    const count = await api.client.query<{ n: number }>(
      `select count(*)::int as n from transactions where description = 'raw'`,
    )
    expect(count.rows[0]!.n).toBe(0)
  })

  it('rejects postings to archived accounts', async () => {
    await api.call('PATCH', `/accounts/${ids.Savings}`, { archived: true })
    const res = await api.call(
      'POST',
      '/transactions',
      txn('2026-11-05', 'To savings', [
        [ids.Savings!, 1000],
        [ids.Checking!, -1000],
      ]),
    )
    expect(res.status).toBe(400)
    await api.call('PATCH', `/accounts/${ids.Savings}`, { archived: false })
  })

  it('PUT replaces postings; DELETE removes the transaction and its postings', async () => {
    const created = await api.call(
      'POST',
      '/transactions',
      txn('2026-11-06', 'Paycheck', [
        [ids.Checking!, 300000],
        [ids.Salary!, -300000],
      ]),
    )
    const id = created.body.id
    const updated = await api.call(
      'PUT',
      `/transactions/${id}`,
      txn('2026-11-06', 'Paycheck (split)', [
        [ids.Checking!, 250000],
        [ids.Savings!, 50000],
        [ids.Salary!, -300000],
      ]),
    )
    expect(updated.status).toBe(200)
    expect(updated.body.postings).toHaveLength(3)

    expect((await api.call('DELETE', `/transactions/${id}`)).status).toBe(200)
    expect((await api.call('GET', `/transactions/${id}`)).status).toBe(404)
    const orphans = await api.client.query<{ n: number }>(
      `select count(*)::int as n from postings where transaction_id = ${id}`,
    )
    expect(orphans.rows[0]!.n).toBe(0)
  })
})

describe('account register', () => {
  it('computes running balances over full history, correct across pages', async () => {
    const acct = await api.call('POST', '/accounts', {
      name: 'Wallet',
      type: 'asset',
      openingBalanceCents: 10000,
      openingDate: '2026-10-01',
    })
    const wallet = acct.body.id
    for (const [day, cents] of [
      ['2026-10-02', -1000],
      ['2026-10-03', -2000],
      ['2026-10-04', 500],
    ] as const) {
      await api.call(
        'POST',
        '/transactions',
        txn(day, `Wallet ${day}`, [
          [wallet, cents],
          [ids.Dining!, -cents],
        ]),
      )
    }

    const page1 = await api.call(
      'GET',
      `/transactions?accountId=${wallet}&limit=2`,
    )
    expect(page1.body.items.map((t: any) => t.runningBalanceCents)).toEqual([
      7500, 7000,
    ])
    expect(page1.body.nextCursor).toBeTruthy()
    const page2 = await api.call(
      'GET',
      `/transactions?accountId=${wallet}&limit=2&cursor=${page1.body.nextCursor}`,
    )
    // The opening entry is hidden but still counted in the balance.
    expect(page2.body.items.map((t: any) => t.runningBalanceCents)).toEqual([
      9000,
    ])
    expect(page2.body.nextCursor).toBeNull()
  })

  it('filters by text search', async () => {
    const res = await api.call('GET', '/transactions?q=krog')
    expect(res.body.items.map((t: any) => t.description)).toEqual(['Kroger'])
  })

  it('suggests recent descriptions with their postings', async () => {
    const res = await api.call('GET', '/transactions/suggest?q=Kro')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].postings).toHaveLength(2)
  })
})

describe('dashboard', () => {
  it('reports net worth, cash, and monthly spending', async () => {
    const res = await api.call('GET', '/dashboard?today=2026-11-20')
    expect(res.status).toBe(200)
    // November expense: Kroger 42.50. October: wallet dining 10 + 20 - 5 = 25.
    expect(res.body.spending.thisMonthCents).toBe(4250)
    expect(res.body.spending.lastMonthCents).toBe(2500)
    expect(res.body.spending.topCategories[0].name).toBe('Groceries')
    // Assets: brokerage 2500 + wallet 75 - kroger 42.50; liabilities: store card -420.
    expect(res.body.cashCents).toBe(250000 + 7500 - 4250)
    expect(res.body.bookNetWorthCents).toBe(250000 + 7500 - 4250 - 42000)
    expect(res.body.recent.length).toBeGreaterThan(0)
  })
})
