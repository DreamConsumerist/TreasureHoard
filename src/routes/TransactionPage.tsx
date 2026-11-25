// /ledger/new and /ledger/:id: the transaction form as a full page.
// Transactions that belong to a collection item are shown read-only, with a
// link to the item: they're edited from there so the books stay in step.
// /ledger/new can arrive with a prefill in the router's location state
// (Record payment on the Dashboard).

import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { occurrenceDate } from '../../lib/ledger/recurring.ts'
import { toNatural } from '../../lib/ledger/sign.ts'
import { Amount } from '../components/Amount.tsx'
import { LedgerTabs } from '../components/AppShell.tsx'
import type { RecurringPrefill } from '../components/RecurringForm.tsx'
import {
  TransactionForm,
  type TransactionPrefill,
} from '../components/TransactionForm.tsx'
import {
  useAccounts,
  useDeleteTransaction,
  useTransaction,
  type TransactionOut,
} from '../lib/queries.ts'

function ReadOnlyTransaction({ txn }: { txn: TransactionOut }) {
  const { byId } = useAccounts()
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-800">
        This entry belongs to a collection item.{' '}
        <Link
          to={`/collection/${txn.linkedItemId}`}
          className="font-medium underline"
        >
          Open the item
        </Link>{' '}
        to change it, so the item and the books stay in step.
      </p>
      <div className="text-sm">
        <div className="font-medium">{txn.description}</div>
        <div className="text-zinc-500">
          {txn.date} · {txn.status}
        </div>
      </div>
      <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
        {txn.postings.map((p) => {
          const account = byId.get(p.accountId)
          return (
            <li key={p.id} className="flex justify-between py-1.5">
              <span>{account?.path ?? '…'}</span>
              <span className="text-zinc-500">
                {p.amountCents > 0 ? 'in ' : 'out '}
                <Amount
                  cents={
                    account
                      ? Math.abs(toNatural(p.amountCents, account.type))
                      : Math.abs(p.amountCents)
                  }
                />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function TransactionPage() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = (location.state as { prefill?: TransactionPrefill } | null)
    ?.prefill
  const id = params.id ? Number(params.id) : null
  const txn = useTransaction(id)
  const del = useDeleteTransaction()
  const linked = Boolean(txn.data?.linkedItemId)

  const back = () =>
    window.history.length > 1 ? navigate(-1) : navigate('/ledger')

  return (
    <div className="max-w-xl">
      <LedgerTabs />
      <h1 className="mb-4 text-xl font-semibold">
        {!id ? 'New transaction' : linked ? 'Transaction' : 'Edit transaction'}
      </h1>

      {id && txn.isPending && <p className="text-sm text-zinc-500">Loading…</p>}
      {id && txn.error && (
        <p className="text-sm text-red-600">{txn.error.message}</p>
      )}

      {txn.data && linked && (
        <div className="card">
          <ReadOnlyTransaction txn={txn.data} />
        </div>
      )}

      {(!id || (txn.data && !linked)) && (
        <div className="card">
          {txn.data?.kind === 'opening' && (
            <p className="mb-3 text-sm text-zinc-500">
              This is an opening-balance entry: it sets the account's starting
              balance.
            </p>
          )}
          {txn.data?.recurringTemplateId != null && (
            <p className="mb-3 text-sm text-zinc-500">
              Created by a recurring transaction.{' '}
              <Link
                to={`/ledger/recurring/${txn.data.recurringTemplateId}`}
                className="underline"
              >
                Edit the recurring transaction
              </Link>{' '}
              to change future ones.
            </p>
          )}
          <TransactionForm
            key={txn.data?.id ?? 'new'}
            initial={txn.data}
            prefill={id ? undefined : prefill}
            onSaved={back}
          />
        </div>
      )}

      {txn.data && !linked && (
        <div className="mt-4 flex justify-between gap-2">
          {txn.data.kind === 'normal' &&
          txn.data.recurringTemplateId === null ? (
            <button
              onClick={() => {
                const t = txn.data
                const state: { prefill: RecurringPrefill } = {
                  prefill: {
                    description: t.description,
                    postings: t.postings.map((p) => ({
                      accountId: p.accountId,
                      amountCents: p.amountCents,
                      memo: p.memo,
                    })),
                    // This one is already entered: start a month later.
                    startDate: occurrenceDate(
                      { frequency: 'month', interval: 1, startDate: t.date },
                      1,
                    ),
                  },
                }
                navigate('/ledger/recurring/new', { state })
              }}
              className="btn"
            >
              Make recurring
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={() => {
              if (confirm('Delete this transaction? This cannot be undone.')) {
                del.mutate(txn.data.id, {
                  onSuccess: () => navigate('/ledger'),
                })
              }
            }}
            disabled={del.isPending}
            className="btn-danger"
          >
            Delete transaction
          </button>
        </div>
      )}
      {del.error && (
        <p className="mt-2 text-sm text-red-600">{del.error.message}</p>
      )}
    </div>
  )
}
