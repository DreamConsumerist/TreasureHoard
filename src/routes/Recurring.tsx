// /ledger/recurring: every recurring template with its schedule, amount and
// next date. Due ones are confirmed from the Dashboard.

import { Link } from 'react-router'
import {
  describeSchedule,
  transactionTotal,
} from '../../lib/ledger/recurring.ts'
import { Amount } from '../components/Amount.tsx'
import { LedgerTabs } from '../components/AppShell.tsx'
import { useAccounts, useRecurringTemplates } from '../lib/queries.ts'

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export default function Recurring() {
  const list = useRecurringTemplates()
  const { byId } = useAccounts()
  const name = (id: number) => byId.get(id)?.name ?? '…'

  return (
    <div>
      <LedgerTabs />
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Recurring</h1>
        <Link to="/ledger/recurring/new" className="btn-primary">
          + New recurring
        </Link>
      </header>

      {list.isPending && <p className="text-sm text-zinc-500">Loading…</p>}
      {list.error && (
        <p className="text-sm text-red-600">{list.error.message}</p>
      )}
      {list.data?.length === 0 && (
        <div className="card text-sm text-zinc-500">
          Nothing recurring yet. Add rent, a paycheck or a bill here, or open a
          transaction you've already entered and choose{' '}
          <span className="font-medium">Make recurring</span>. Each one appears
          on the Dashboard when it's due, for you to confirm.
        </div>
      )}

      {list.data && list.data.length > 0 && (
        <ul className="card divide-y divide-zinc-200 p-0 dark:divide-zinc-800">
          {list.data.map((t) => {
            const debits = t.postings.filter((p) => p.amountCents > 0)
            const credits = t.postings.filter((p) => p.amountCents < 0)
            const flow =
              t.postings.length === 2
                ? `${name(credits[0]!.accountId)} → ${name(debits[0]!.accountId)}`
                : `Split across ${t.postings.length} accounts`
            return (
              <li key={t.id}>
                <Link
                  to={`/ledger/recurring/${t.id}`}
                  className="flex items-start gap-3 p-3 hover:bg-zinc-100 sm:items-center dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {t.description}
                      {!t.active && (
                        <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-normal text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          paused
                        </span>
                      )}
                      {t.pendingCount > 0 && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {t.pendingCount} to confirm
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-sm text-zinc-500">
                      {describeSchedule(t)} · {flow}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block">
                      {t.variable && (
                        <span className="text-sm text-zinc-500">about </span>
                      )}
                      <Amount cents={transactionTotal(t.postings)} />
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {t.nextDue
                        ? `Next ${shortDate(t.nextDue)}`
                        : t.active
                          ? 'Ended'
                          : 'Paused'}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
