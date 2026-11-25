// /ledger/recurring/new and /ledger/recurring/:id: the template editor as a
// page. "Make recurring" on a transaction arrives here with a prefill in the
// router's location state.

import { useLocation, useNavigate, useParams } from 'react-router'
import { LedgerTabs } from '../components/AppShell.tsx'
import {
  RecurringForm,
  type RecurringPrefill,
} from '../components/RecurringForm.tsx'
import { useDeleteRecurring, useRecurringTemplate } from '../lib/queries.ts'

export default function RecurringEdit() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const id = params.id ? Number(params.id) : null
  const template = useRecurringTemplate(id)
  const del = useDeleteRecurring()
  const prefill = (location.state as { prefill?: RecurringPrefill } | null)
    ?.prefill

  const done = () => navigate('/ledger/recurring')

  return (
    <div className="max-w-xl">
      <LedgerTabs />
      <h1 className="mb-4 text-xl font-semibold">
        {id ? 'Edit recurring' : 'New recurring'}
      </h1>

      {id && template.isPending && (
        <p className="text-sm text-zinc-500">Loading…</p>
      )}
      {id && template.error && (
        <p className="text-sm text-red-600">{template.error.message}</p>
      )}

      {(!id || template.data) && (
        <div className="card">
          <RecurringForm
            key={template.data?.id ?? 'new'}
            initial={template.data}
            prefill={prefill}
            onSaved={done}
          />
        </div>
      )}

      {template.data && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => {
              if (
                confirm(
                  'Delete this recurring transaction? Ones already created stay in the ledger.',
                )
              ) {
                del.mutate(template.data.id, { onSuccess: done })
              }
            }}
            disabled={del.isPending}
            className="btn-danger"
          >
            Delete recurring
          </button>
        </div>
      )}
      {del.error && (
        <p className="mt-2 text-sm text-red-600">{del.error.message}</p>
      )}
    </div>
  )
}
