// The Dashboard's "Owed to you" card: each person under the "Owed to me"
// account with a balance, when they last paid, and a Record payment button
// that opens a prefilled transfer (their account → wherever the money landed).

import { Link, useNavigate } from 'react-router'
import type { OwedToYou as Owed } from '../../lib/ledger/types.ts'
import type { TransactionPrefill } from './TransactionForm.tsx'
import { Amount } from './Amount.tsx'

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export function OwedToYou({ owed }: { owed: Owed[] }) {
  const navigate = useNavigate()
  if (owed.length === 0) return null

  const recordPayment = (o: Owed) => {
    // They owe you: money moves from their account into one of yours (you pick).
    // You owe them (overpaid): the other way round.
    const prefill: TransactionPrefill =
      o.balanceCents > 0
        ? {
            description: `${o.name} paid me back`,
            simple: {
              amountCents: o.balanceCents,
              fromAccountId: o.accountId,
              toAccountId: null,
            },
          }
        : {
            description: `Paid back ${o.name}`,
            simple: {
              amountCents: -o.balanceCents,
              fromAccountId: null,
              toAccountId: o.accountId,
            },
          }
    navigate('/ledger/new', { state: { prefill } })
  }

  return (
    <section className="card">
      <h2 className="mb-2 font-medium">Owed to you</h2>
      <ul className="space-y-2">
        {owed.map((o) => (
          <li key={o.accountId} className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <Link
                to={`/ledger/accounts/${o.accountId}`}
                className="block truncate text-sm font-medium hover:underline"
              >
                {o.name}
              </Link>
              <span className="block text-xs text-zinc-500">
                {o.lastPaymentDate
                  ? `Last paid ${shortDate(o.lastPaymentDate)}`
                  : 'No payments yet'}
              </span>
            </span>
            <span className="shrink-0 text-right text-sm">
              {o.balanceCents < 0 && (
                <span className="text-zinc-500">you owe </span>
              )}
              <Amount cents={Math.abs(o.balanceCents)} />
            </span>
            <button
              type="button"
              className="btn shrink-0"
              onClick={() => recordPayment(o)}
            >
              Record payment
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
