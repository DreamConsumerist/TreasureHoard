// /ledger/accounts/:id: one account's transactions with a running balance.

import { useState } from 'react'
import { useParams } from 'react-router'
import { toNatural } from '../../lib/ledger/sign.ts'
import { Amount } from '../components/Amount.tsx'
import { LedgerTabs } from '../components/AppShell.tsx'
import { TransactionList } from '../components/TransactionList.tsx'
import { useAccounts, useTransactions } from '../lib/queries.ts'

export default function AccountRegister() {
  const id = Number(useParams().id)
  const { byId, isPending } = useAccounts()
  const account = byId.get(id)
  const [includeOpening, setIncludeOpening] = useState(false)
  const list = useTransactions({ accountId: id, includeOpening })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  if (isPending) return <p className="text-sm text-zinc-500">Loading…</p>
  if (!account)
    return <p className="text-sm text-red-600">Account not found.</p>

  return (
    <div>
      <LedgerTabs />
      <header className="mb-4">
        <h1 className="text-xl font-semibold">{account.path}</h1>
        <div className="mt-1 flex flex-wrap gap-x-6 text-sm text-zinc-500">
          <span>
            Balance:{' '}
            <Amount
              cents={toNatural(account.totalCents, account.type)}
              tone
              className="font-medium text-zinc-900 dark:text-zinc-100"
            />
          </span>
          <span>
            Cleared:{' '}
            <Amount
              cents={toNatural(account.clearedBalanceCents, account.type)}
            />
          </span>
          {account.children.length > 0 && (
            <span>(balance includes sub-accounts)</span>
          )}
        </div>
      </header>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeOpening}
          onChange={(e) => setIncludeOpening(e.target.checked)}
        />
        Show opening balance
      </label>

      {list.error && (
        <p className="text-sm text-red-600">{list.error.message}</p>
      )}
      {list.isPending ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <TransactionList items={items} account={{ id, type: account.type }} />
      )}
      {list.hasNextPage && (
        <button
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
          className="btn mt-3 w-full"
        >
          {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
