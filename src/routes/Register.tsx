import { useState } from 'react'
import { LedgerTabs } from '../components/AppShell.tsx'
import { TransactionList } from '../components/TransactionList.tsx'
import { useDebounced } from '../lib/hooks.ts'
import { useQuickAdd } from '../lib/quickAdd.ts'
import { useTransactions } from '../lib/queries.ts'

export default function Register() {
  const openQuickAdd = useQuickAdd()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | 'pending' | 'cleared'>('')
  const [includeOpening, setIncludeOpening] = useState(false)
  const q = useDebounced(search.trim())
  const list = useTransactions({
    q: q || undefined,
    status: status || undefined,
    includeOpening,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div>
      <LedgerTabs />
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Register</h1>
        <button onClick={openQuickAdd} className="btn-primary">
          + New transaction
        </button>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search descriptions"
          className="input max-w-xs flex-1"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="input w-auto"
          aria-label="Status"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="cleared">Cleared</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeOpening}
            onChange={(e) => setIncludeOpening(e.target.checked)}
          />
          Show opening balances
        </label>
      </div>

      {list.error && (
        <p className="text-sm text-red-600">{list.error.message}</p>
      )}
      {list.isPending ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <TransactionList items={items} empty="No matching transactions." />
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
