import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { formatMoney } from '../../lib/ledger/money.ts'
import { Amount } from '../components/Amount.tsx'
import { DueCard } from '../components/DueCard.tsx'
import { GainBadge, Thumb } from '../components/ItemList.tsx'
import { OwedToYou } from '../components/OwedToYou.tsx'
import { PriceChange } from '../components/PriceChange.tsx'
import { StalePricesNotice } from '../components/PriceSync.tsx'
import { TransactionList } from '../components/TransactionList.tsx'
import { useDashboard } from '../lib/queries.ts'

function Stat({
  label,
  cents,
  hint,
}: {
  label: string
  cents: number
  hint?: ReactNode
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

      <StalePricesNotice />
      {isPending && <p className="text-sm text-zinc-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Net worth"
              cents={data.marketNetWorthCents}
              hint={`Book (collection at cost): ${formatMoney(data.bookNetWorthCents)}`}
            />
            <Stat
              label="Cash"
              cents={data.cashCents}
              hint="Excludes the collection and money owed to you"
            />
            <Stat
              label="Collection"
              cents={data.collectionMarketCents}
              hint={
                <>
                  Cost {formatMoney(data.collectionCostCents)} ·{' '}
                  <GainBadge
                    cents={
                      data.collectionMarketCents - data.collectionCostCents
                    }
                  />
                </>
              }
            />
            <Stat
              label="Spent this month"
              cents={data.spending.thisMonthCents}
              hint={`Last month: ${formatMoney(data.spending.lastMonthCents)}`}
            />
          </div>

          <DueCard
            due={data.recurring.due}
            upcoming={data.recurring.upcoming}
          />
          <OwedToYou owed={data.owedToYou} />

          {data.movers.length > 0 && (
            <section className="card">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-medium">Movers this week</h2>
                <Link
                  to="/collection"
                  className="text-sm text-zinc-500 hover:underline"
                >
                  Collection
                </Link>
              </div>
              <ul className="space-y-2">
                {data.movers.map((m) => (
                  <li key={m.itemId}>
                    <Link
                      to={`/collection/${m.itemId}`}
                      className="flex items-center gap-3 hover:underline"
                    >
                      <Thumb src={m.imageUrl} size="h-10 w-7" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {m.name}
                        {m.quantity > 1 && (
                          <span className="ml-1 text-zinc-500">
                            ×{m.quantity}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <Amount
                          cents={m.valueCents}
                          className="block text-sm"
                        />
                        <PriceChange cents={m.changeCents} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

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
