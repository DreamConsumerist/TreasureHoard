// The amount-and-accounts part of a transaction, shared by the transaction
// form and the recurring-template form. The state lives in usePostingsDraft
// (src/lib/usePostingsDraft.ts); these components render its parts, so each
// form can place them in its own layout.
//
// Split mode shows one row per posting with Debit and Credit columns, plus a
// live "remaining" counter.

import { formatMoney } from '../../lib/ledger/money.ts'
import { postingsToSimple } from '../../lib/ledger/postings.ts'
import { line, type PostingsDraft } from '../lib/usePostingsDraft.ts'
import { AccountPicker } from './AccountPicker.tsx'
import { MoneyInput } from './MoneyInput.tsx'

/** The big Amount field (simple mode only). */
export function DraftAmount({
  draft,
  autoFocus = false,
  label = 'Amount',
}: {
  draft: PostingsDraft
  autoFocus?: boolean
  label?: string
}) {
  if (draft.mode !== 'simple') return null
  return (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      <MoneyInput
        value={draft.amount}
        onChange={draft.setAmount}
        placeholder="0.00"
        autoFocus={autoFocus}
        large
      />
    </label>
  )
}

/** From → To pickers in simple mode; the postings grid in split mode. */
export function DraftAccounts({ draft }: { draft: PostingsDraft }) {
  if (draft.mode === 'simple') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="label">From</span>
          <AccountPicker
            value={draft.fromId}
            onChange={draft.setFromId}
            placeholder="Where the money came from"
            aria-label="From account"
          />
        </label>
        <label className="block space-y-1">
          <span className="label">To</span>
          <AccountPicker
            value={draft.toId}
            onChange={draft.setToId}
            placeholder="Where it went"
            aria-label="To account"
          />
        </label>
      </div>
    )
  }
  const { lines, updateLine, setLines, splitRemaining } = draft
  return (
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
            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
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
        Debit = the account money went to (or an expense). Credit = the account
        it came from.
      </p>
    </div>
  )
}

/** The Split / Simple switch. */
export function DraftModeToggle({ draft }: { draft: PostingsDraft }) {
  const { mode, postings } = draft
  return (
    <button
      type="button"
      onClick={mode === 'simple' ? draft.switchToSplit : draft.switchToSimple}
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
  )
}
