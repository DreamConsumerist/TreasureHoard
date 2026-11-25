// The one transaction form, used by the full page and the quick-add sheet.
//
// Simple mode: Amount · Description · From → To · Date · Status · Notes.
// It becomes two postings: debit "To", credit "From" (lib/ledger/postings.ts).
//
// Split mode: one row per posting with Debit and Credit columns, plus a live
// "remaining" counter. Save stays disabled until debits equal credits.

import { useState, type FormEvent } from 'react'
import {
  centsToInput,
  formatMoney,
  parseMoney,
} from '../../lib/ledger/money.ts'
import {
  postingsToSimple,
  simpleToPostings,
  validatePostings,
  type PostingInput,
} from '../../lib/ledger/postings.ts'
import { useDebounced } from '../lib/hooks.ts'
import {
  todayLocal,
  useSaveTransaction,
  useSuggestions,
  type TransactionOut,
} from '../lib/queries.ts'
import { AccountPicker } from './AccountPicker.tsx'
import { MoneyInput } from './MoneyInput.tsx'

interface SplitLine {
  key: number
  accountId: number | null
  debit: string
  credit: string
  memo: string
}

let nextKey = 1
const line = (
  accountId: number | null = null,
  cents = 0,
  memo = '',
): SplitLine => ({
  key: nextKey++,
  accountId,
  debit: cents > 0 ? centsToInput(cents) : '',
  credit: cents < 0 ? centsToInput(-cents) : '',
  memo,
})

/** Converts a split line's text fields to a signed amount (debit +, credit −), or null if invalid. */
function lineCents(l: SplitLine): number | null {
  const debit = l.debit.trim() ? parseMoney(l.debit) : 0
  const credit = l.credit.trim() ? parseMoney(l.credit) : 0
  if (debit === null || credit === null) return null
  return debit - credit
}

export function TransactionForm({
  initial,
  onSaved,
  autoFocus = false,
}: {
  initial?: TransactionOut
  onSaved: (txn: TransactionOut) => void
  autoFocus?: boolean
}) {
  const simple = initial ? postingsToSimple(initial.postings) : null
  const [mode, setMode] = useState<'simple' | 'split'>(
    initial && !simple ? 'split' : 'simple',
  )
  const [description, setDescription] = useState(initial?.description ?? '')
  const [date, setDate] = useState(initial?.date ?? todayLocal())
  const [status, setStatus] = useState<'pending' | 'cleared'>(
    initial?.status ?? 'cleared',
  )
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [amount, setAmount] = useState(
    simple ? centsToInput(simple.amountCents) : '',
  )
  const [fromId, setFromId] = useState<number | null>(
    simple?.fromAccountId ?? null,
  )
  const [toId, setToId] = useState<number | null>(simple?.toAccountId ?? null)
  const [lines, setLines] = useState<SplitLine[]>(() =>
    initial && !simple
      ? initial.postings.map((p) =>
          line(p.accountId, p.amountCents, p.memo ?? ''),
        )
      : [line(), line()],
  )
  const [showSuggestions, setShowSuggestions] = useState(false)
  const save = useSaveTransaction()

  // Suggestions only when creating, and only while the description field is being typed in.
  const debouncedDescription = useDebounced(description)
  const suggestions = useSuggestions(
    !initial && showSuggestions ? debouncedDescription : '',
  )

  // --- Build postings from whichever mode is active ---
  let postings: PostingInput[] | null = null
  if (mode === 'simple') {
    const cents = parseMoney(amount)
    if (
      cents !== null &&
      cents > 0 &&
      fromId !== null &&
      toId !== null &&
      fromId !== toId
    ) {
      postings = simpleToPostings({
        amountCents: cents,
        fromAccountId: fromId,
        toAccountId: toId,
      })
    }
  } else {
    const built = lines.map((l) => ({ l, cents: lineCents(l) }))
    if (
      built.every(
        ({ l, cents }) => cents !== null && l.accountId !== null && cents !== 0,
      )
    ) {
      postings = built.map(({ l, cents }) => ({
        accountId: l.accountId!,
        amountCents: cents!,
        memo: l.memo.trim() || null,
      }))
    }
  }
  const splitRemaining = lines.reduce((sum, l) => sum + (lineCents(l) ?? 0), 0)
  const problems = postings
    ? validatePostings(postings)
    : ['Fill in the amount and accounts.']
  const canSave =
    description.trim() !== '' && problems.length === 0 && !save.isPending

  function switchToSplit() {
    const cents = parseMoney(amount) ?? 0
    setLines([line(toId, cents), line(fromId, -cents)])
    setMode('split')
  }

  function switchToSimple() {
    const asSimple = postings ? postingsToSimple(postings) : null
    if (asSimple) {
      setAmount(centsToInput(asSimple.amountCents))
      setFromId(asSimple.fromAccountId)
      setToId(asSimple.toAccountId)
    }
    setMode('simple')
  }

  function applySuggestion(s: {
    description: string
    postings: PostingInput[]
  }) {
    setDescription(s.description)
    setShowSuggestions(false)
    const asSimple = postingsToSimple(s.postings)
    if (asSimple) {
      setMode('simple')
      setAmount(centsToInput(asSimple.amountCents))
      setFromId(asSimple.fromAccountId)
      setToId(asSimple.toAccountId)
    } else {
      setMode('split')
      setLines(
        s.postings.map((p) => line(p.accountId, p.amountCents, p.memo ?? '')),
      )
    }
  }

  function updateLine(key: number, patch: Partial<SplitLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
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
      {mode === 'simple' && (
        <label className="block space-y-1">
          <span className="label">Amount</span>
          <MoneyInput
            value={amount}
            onChange={setAmount}
            placeholder="0.00"
            autoFocus={autoFocus}
            large
          />
        </label>
      )}

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
          autoFocus={autoFocus && mode === 'split'}
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

      {mode === 'simple' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="label">From</span>
            <AccountPicker
              value={fromId}
              onChange={setFromId}
              placeholder="Where the money came from"
              aria-label="From account"
            />
          </label>
          <label className="block space-y-1">
            <span className="label">To</span>
            <AccountPicker
              value={toId}
              onChange={setToId}
              placeholder="Where it went"
              aria-label="To account"
            />
          </label>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_7rem_7rem_2rem] gap-2 sm:grid">
            <span className="label">Account</span>
            <span className="label">Debit</span>
            <span className="label">Credit</span>
          </div>
          {lines.map((l) => (
            <div
              key={l.key}
              className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 p-2 sm:grid-cols-[1fr_7rem_7rem_2rem] sm:border-0 sm:p-0 dark:border-zinc-800"
            >
              <div className="col-span-2 space-y-1 sm:col-span-1">
                <AccountPicker
                  value={l.accountId}
                  onChange={(id) => updateLine(l.key, { accountId: id })}
                  aria-label="Account"
                />
                <input
                  value={l.memo}
                  onChange={(e) => updateLine(l.key, { memo: e.target.value })}
                  placeholder="Memo (optional)"
                  className="input py-1 text-sm"
                />
              </div>
              <MoneyInput
                value={l.debit}
                onChange={(v) =>
                  updateLine(l.key, { debit: v, credit: v ? '' : l.credit })
                }
                placeholder="Debit"
                aria-label="Debit"
              />
              <MoneyInput
                value={l.credit}
                onChange={(v) =>
                  updateLine(l.key, { credit: v, debit: v ? '' : l.debit })
                }
                placeholder="Credit"
                aria-label="Credit"
              />
              <button
                type="button"
                onClick={() =>
                  setLines((ls) => ls.filter((x) => x.key !== l.key))
                }
                disabled={lines.length <= 2}
                className="btn col-span-2 sm:col-span-1"
                aria-label="Remove line"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, line()])}
              className="btn"
            >
              + Add line
            </button>
            <span
              className={`text-sm tabular-nums ${splitRemaining === 0 ? 'text-green-600' : 'text-amber-600'}`}
            >
              {splitRemaining === 0
                ? 'Balanced'
                : `Remaining: ${formatMoney(Math.abs(splitRemaining))} ${splitRemaining > 0 ? 'credit' : 'debit'}`}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Debit = the account money went to (or an expense). Credit = the
            account it came from.
          </p>
        </div>
      )}

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
        <button
          type="button"
          onClick={mode === 'simple' ? switchToSplit : switchToSimple}
          className="btn"
          disabled={
            mode === 'split' && postings !== null && !postingsToSimple(postings)
          }
          title={
            mode === 'split'
              ? 'Only a two-line, balanced split can go back to simple'
              : undefined
          }
        >
          {mode === 'simple' ? 'Split' : 'Simple'}
        </button>
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
