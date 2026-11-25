// A list of transactions, used by the register, account registers and the
// dashboard. Rows stack on phones and spread into columns on wider screens.
//
// In the general register each row shows the transaction's size and its flow
// ("Checking → Groceries"). In an account register (`account` given) it shows
// the effect on that account and the running balance, in natural sign.

import { Link } from 'react-router'
import type { AccountType } from '../../lib/ledger/sign.ts'
import { toNatural } from '../../lib/ledger/sign.ts'
import { useAccounts, type TransactionOut } from '../lib/queries.ts'
import { Amount } from './Amount.tsx'

function formatDate(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function TransactionList({
  items,
  account,
  empty = 'No transactions yet.',
}: {
  items: TransactionOut[]
  account?: { id: number; type: AccountType }
  empty?: string
}) {
  const { byId } = useAccounts()
  const name = (id: number) => byId.get(id)?.path ?? '…'

  if (items.length === 0)
    return <p className="py-6 text-center text-sm text-zinc-500">{empty}</p>

  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {items.map((t) => {
        const debits = t.postings.filter((p) => p.amountCents > 0)
        const credits = t.postings.filter((p) => p.amountCents < 0)
        const size = debits.reduce((s, p) => s + p.amountCents, 0)
        const flow = account
          ? t.postings
              .filter((p) => p.accountId !== account.id)
              .map((p) => name(p.accountId))
              .join(', ')
          : t.postings.length === 2
            ? `${name(credits[0]!.accountId)} → ${name(debits[0]!.accountId)}`
            : `Split across ${t.postings.length} accounts`

        return (
          <li key={t.id}>
            <Link
              to={`/ledger/${t.id}`}
              className="flex items-start gap-3 px-1 py-3 hover:bg-zinc-100 sm:items-center dark:hover:bg-zinc-900"
            >
              <span className="w-24 shrink-0 text-sm text-zinc-500 tabular-nums">
                {formatDate(t.date)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {t.description}
                  {t.recurringTemplateId !== null && (
                    <span
                      className="ml-1.5 font-normal text-zinc-500"
                      title="Recurring"
                      aria-label="Recurring"
                    >
                      ↻
                    </span>
                  )}
                  {t.status === 'pending' && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      pending
                    </span>
                  )}
                  {t.kind === 'opening' && (
                    <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-normal text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      opening
                    </span>
                  )}
                </span>
                <span className="block truncate text-sm text-zinc-500">
                  {flow}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {account && t.accountAmountCents !== undefined ? (
                  <>
                    <Amount
                      cents={toNatural(t.accountAmountCents, account.type)}
                      tone
                      className="block"
                    />
                    {t.runningBalanceCents !== undefined && (
                      <Amount
                        cents={toNatural(t.runningBalanceCents, account.type)}
                        className="block text-xs text-zinc-500"
                      />
                    )}
                  </>
                ) : (
                  <Amount cents={size} />
                )}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
