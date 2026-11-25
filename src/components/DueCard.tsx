// The Dashboard's "Due" card: recurring transactions waiting to be confirmed,
// plus what's coming in the next week.
//
//   Confirm  fixed amounts clear in one tap; a variable bill asks for the
//            real total and rescales its split (lib/ledger/recurring.ts).
//   Edit     opens the transaction.
//   Skip     deletes it (it won't be created again).

import { useState } from 'react'
import { Link } from 'react-router'
import {
  centsToInput,
  formatMoney,
  parseMoney,
} from '../../lib/ledger/money.ts'
import { rescaleToTotal, transactionTotal } from '../../lib/ledger/recurring.ts'
import type {
  DueOccurrence,
  UpcomingOccurrence,
} from '../../lib/ledger/types.ts'
import {
  useAccounts,
  useDeleteTransaction,
  useSaveTransaction,
} from '../lib/queries.ts'
import { Amount } from './Amount.tsx'
import { MoneyInput } from './MoneyInput.tsx'

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

function DueRow({ item }: { item: DueOccurrence }) {
  const { transaction: t, variable } = item
  const { byId } = useAccounts()
  const name = (id: number) => byId.get(id)?.name ?? '…'
  const save = useSaveTransaction()
  const del = useDeleteTransaction()
  const [asking, setAsking] = useState(false)
  const [totalText, setTotalText] = useState(
    centsToInput(transactionTotal(t.postings)),
  )

  const lines = t.postings.map((p) => ({
    accountId: p.accountId,
    amountCents: p.amountCents,
    memo: p.memo,
  }))
  const total = parseMoney(totalText)
  const scaled =
    total !== null && total > 0 ? rescaleToTotal(lines, total) : null
  const debits = t.postings.filter((p) => p.amountCents > 0)
  const credits = t.postings.filter((p) => p.amountCents < 0)
  const flow =
    t.postings.length === 2
      ? `${name(credits[0]!.accountId)} → ${name(debits[0]!.accountId)}`
      : `Split across ${t.postings.length} accounts`

  const confirm = (postings: typeof lines) =>
    save.mutate({
      id: t.id,
      date: t.date,
      description: t.description,
      notes: t.notes,
      status: 'cleared',
      postings,
    })

  const busy = save.isPending || del.isPending

  return (
    <li className="space-y-2 py-2">
      <div className="flex items-start gap-3">
        <span className="w-24 shrink-0 text-sm text-zinc-500">
          {shortDate(t.date)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {t.description}
          </span>
          <span className="block truncate text-xs text-zinc-500">{flow}</span>
        </span>
        <span className="shrink-0 text-sm">
          {variable && <span className="text-zinc-500">about </span>}
          <Amount cents={transactionTotal(t.postings)} />
        </span>
      </div>

      {asking ? (
        <div className="ml-0 space-y-2 rounded-lg bg-zinc-50 p-3 sm:ml-27 dark:bg-zinc-900">
          <label className="block space-y-1">
            <span className="label">The real total</span>
            <MoneyInput
              value={totalText}
              onChange={setTotalText}
              autoFocus
              aria-label="Real total"
            />
          </label>
          {scaled ? (
            t.postings.length > 2 && (
              <ul className="text-xs text-zinc-500">
                {scaled.map((p, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{name(p.accountId)}</span>
                    <span className="tabular-nums">
                      {p.amountCents < 0 ? 'paid ' : ''}
                      {formatMoney(Math.abs(p.amountCents))}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : total !== null && total > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              This split can't be rescaled automatically.{' '}
              <Link to={`/ledger/${t.id}`} className="underline">
                Edit it instead
              </Link>
              .
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!scaled || busy}
              onClick={() => scaled && confirm(scaled)}
            >
              {save.isPending
                ? 'Saving…'
                : `Confirm ${total ? formatMoney(total) : ''}`}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setAsking(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 sm:ml-27">
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => (variable ? setAsking(true) : confirm(lines))}
          >
            {save.isPending ? 'Saving…' : 'Confirm'}
          </button>
          <Link to={`/ledger/${t.id}`} className="btn">
            Edit
          </Link>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Skip ${t.description} on ${shortDate(t.date)}? It will be removed and not created again.`,
                )
              )
                del.mutate(t.id)
            }}
          >
            Skip
          </button>
        </div>
      )}
      {(save.error ?? del.error) && (
        <p className="text-sm text-red-600">
          {(save.error ?? del.error)!.message}
        </p>
      )}
    </li>
  )
}

export function DueCard({
  due,
  upcoming,
}: {
  due: DueOccurrence[]
  upcoming: UpcomingOccurrence[]
}) {
  if (due.length === 0 && upcoming.length === 0) return null
  return (
    <section className="card">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-medium">
          {due.length > 0 ? `Due (${due.length})` : 'Coming up'}
        </h2>
        <Link
          to="/ledger/recurring"
          className="text-sm text-zinc-500 hover:underline"
        >
          Recurring
        </Link>
      </div>
      {due.length > 0 && (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {due.map((d) => (
            <DueRow key={d.transaction.id} item={d} />
          ))}
        </ul>
      )}
      {upcoming.length > 0 && (
        <div
          className={
            due.length > 0
              ? 'mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800'
              : ''
          }
        >
          {due.length > 0 && <div className="label mb-1">Next 7 days</div>}
          <ul className="space-y-1 text-sm text-zinc-500">
            {upcoming.map((u) => (
              <li key={`${u.templateId}-${u.date}`} className="flex gap-3">
                <span className="w-24 shrink-0">{shortDate(u.date)}</span>
                <span className="min-w-0 flex-1 truncate">{u.description}</span>
                <span className="shrink-0 tabular-nums">
                  {u.variable ? 'about ' : ''}
                  {formatMoney(u.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
