// The one transaction form, used by the full page and the quick-add sheet.
//
// Simple mode: Amount · Description · From → To · Date · Status · Notes.
// Split mode: the postings grid. The amount-and-accounts part is shared with
// the recurring-template form (PostingsEditor.tsx).

import { useState, type FormEvent } from 'react'
import type { PostingInput } from '../../lib/ledger/postings.ts'
import { useDebounced } from '../lib/hooks.ts'
import {
  todayLocal,
  useSaveTransaction,
  useSuggestions,
  type TransactionOut,
} from '../lib/queries.ts'
import {
  DraftAccounts,
  DraftAmount,
  DraftModeToggle,
} from './PostingsEditor.tsx'
import {
  usePostingsDraft,
  type PartialSimple,
} from '../lib/usePostingsDraft.ts'

/** Starting values for a new transaction (e.g. Record payment). */
export interface TransactionPrefill {
  description?: string
  postings?: PostingInput[]
  /** A simple-form start that may leave an account blank. */
  simple?: PartialSimple
  date?: string
}

export function TransactionForm({
  initial,
  prefill,
  onSaved,
  autoFocus = false,
}: {
  initial?: TransactionOut
  prefill?: TransactionPrefill
  onSaved: (txn: TransactionOut) => void
  autoFocus?: boolean
}) {
  const draft = usePostingsDraft(
    initial?.postings ?? prefill?.postings,
    prefill?.simple,
  )
  const [description, setDescription] = useState(
    initial?.description ?? prefill?.description ?? '',
  )
  const [date, setDate] = useState(
    initial?.date ?? prefill?.date ?? todayLocal(),
  )
  const [status, setStatus] = useState<'pending' | 'cleared'>(
    initial?.status ?? 'cleared',
  )
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const save = useSaveTransaction()

  // Suggestions only when creating, and only while the description field is being typed in.
  const debouncedDescription = useDebounced(description)
  const suggestions = useSuggestions(
    !initial && showSuggestions ? debouncedDescription : '',
  )

  const { postings, problems } = draft
  const canSave =
    description.trim() !== '' && problems.length === 0 && !save.isPending

  function applySuggestion(s: {
    description: string
    postings: PostingInput[]
  }) {
    setDescription(s.description)
    setShowSuggestions(false)
    draft.load(s.postings)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSave || !postings) return
    save.mutate(
      {
        id: initial?.id,
        date,
        description: description.trim(),
        notes: notes.trim() || null,
        status,
        postings,
      },
      { onSuccess: onSaved },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DraftAmount draft={draft} autoFocus={autoFocus} />

      <label className="relative block space-y-1">
        <span className="label">Description</span>
        <input
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            setShowSuggestions(true)
          }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Payee or what it was for"
          autoFocus={autoFocus && draft.mode === 'split'}
          className="input"
          required
        />
        {showSuggestions && suggestions.data && suggestions.data.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {suggestions.data.map((s) => (
              <li key={s.description}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't hide the list first
                  onClick={() => applySuggestion(s)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {s.description}
                </button>
              </li>
            ))}
          </ul>
        )}
      </label>

      <DraftAccounts draft={draft} />

      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className="label">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="label">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'pending' | 'cleared')}
            className="input"
          >
            <option value="cleared">Cleared</option>
            <option value="pending">Pending</option>
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="label">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="input"
        />
      </label>

      {save.error && (
        <p className="text-sm text-red-600">{save.error.message}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <DraftModeToggle draft={draft} />
        <button
          type="submit"
          disabled={!canSave}
          className="btn-primary px-5 py-2"
        >
          {save.isPending
            ? 'Saving…'
            : initial
              ? 'Save changes'
              : 'Add transaction'}
        </button>
      </div>
    </form>
  )
}
