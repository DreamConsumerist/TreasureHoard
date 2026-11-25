import { Link } from 'react-router'
import { formatMoney } from '../../lib/ledger/money.ts'
import { Amount } from '../components/Amount.tsx'
import { TransactionList } from '../components/TransactionList.tsx'
import { useDashboard } from '../lib/queries.ts'

function Stat({
  label,
  cents,
  hint,
}: {
  label: string
  cents: number
  hint?: string
}) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <Amount
        cents={cents}
        tone
        className="mt-1 block text-2xl font-semibold"
      />
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { data, error, isPending } = useDashboard()

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        {/* Settings lives in the sidebar on desktop; on phones it's this gear. */}
        <Link to="/settings" className="btn md:hidden" aria-label="Settings">
          ⚙
        </Link>
      </header>

      {isPending && <p className="text-sm text-zinc-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Net worth (book)"
              cents={data.bookNetWorthCents}
              hint="Assets − liabilities"
            />
            <Stat label="Cash" cents={data.cashCents} />
            <Stat
              label="Spent this month"
              cents={data.spending.thisMonthCents}
              hint={`Last month: ${formatMoney(data.spending.lastMonthCents)}`}
            />
          </div>

          {data.spending.topCategories.length > 0 && (
            <section className="card">
              <h2 className="mb-2 font-medium">Top spending this month</h2>
              <ul className="space-y-1">
                {data.spending.topCategories.map((c) => (
                  <li
                    key={c.accountId}
                    className="flex justify-between text-sm"
                  >
                    <Link
                      to={`/ledger/accounts/${c.accountId}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                    <Amount cents={c.cents} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-medium">Recent transactions</h2>
              <Link
                to="/ledger"
                className="text-sm text-zinc-500 hover:underline"
              >
                View all
              </Link>
            </div>
            <TransactionList items={data.recent} />
          </section>
        </>
      )}
    </div>
  )
}
