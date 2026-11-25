// /ledger/new and /ledger/:id: the transaction form as a full page.

import { useNavigate, useParams } from 'react-router'
import { LedgerTabs } from '../components/AppShell.tsx'
import { TransactionForm } from '../components/TransactionForm.tsx'
import { useDeleteTransaction, useTransaction } from '../lib/queries.ts'

export default function TransactionPage() {
  const params = useParams()
  const navigate = useNavigate()
  const id = params.id ? Number(params.id) : null
  const txn = useTransaction(id)
  const del = useDeleteTransaction()

  const back = () =>
    window.history.length > 1 ? navigate(-1) : navigate('/ledger')

  return (
    <div className="max-w-xl">
      <LedgerTabs />
      <h1 className="mb-4 text-xl font-semibold">
        {id ? 'Edit transaction' : 'New transaction'}
      </h1>

      {id && txn.isPending && <p className="text-sm text-zinc-500">Loading…</p>}
      {id && txn.error && (
        <p className="text-sm text-red-600">{txn.error.message}</p>
      )}

      {(!id || txn.data) && (
        <div className="card">
          {txn.data?.kind === 'opening' && (
            <p className="mb-3 text-sm text-zinc-500">
              This is an opening-balance entry: it sets the account's starting
              balance.
            </p>
          )}
          <TransactionForm
            key={txn.data?.id ?? 'new'}
            initial={txn.data}
            onSaved={back}
          />
        </div>
      )}

      {txn.data && (
        <div className="mt-4 flex justify-end">
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
