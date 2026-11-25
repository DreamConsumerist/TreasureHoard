// /ledger/accounts: the chart of accounts as a tree, grouped by type, with
// create / edit / archive / delete.

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { centsToInput, parseMoney } from '../../lib/ledger/money.ts'
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  toNatural,
  type AccountType,
} from '../../lib/ledger/sign.ts'
import type { AccountNode } from '../../lib/ledger/tree.ts'
import { AccountPicker } from '../components/AccountPicker.tsx'
import { Amount } from '../components/Amount.tsx'
import { LedgerTabs } from '../components/AppShell.tsx'
import { MoneyInput } from '../components/MoneyInput.tsx'
import {
  todayLocal,
  useAccounts,
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
} from '../lib/queries.ts'

const OPENING_LABEL: Record<AccountType, string> = {
  asset: 'Current balance',
  liability: 'Amount currently owed',
  equity: 'Starting balance',
  income: 'Starting balance',
  expense: 'Starting balance',
}

function NewAccountForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('asset')
  const [parentId, setParentId] = useState<number | null>(null)
  const [opening, setOpening] = useState('')
  const [openingDate, setOpeningDate] = useState(todayLocal())
  const create = useCreateAccount()
  const openingCents = opening.trim() ? parseMoney(opening) : 0
  const showOpening = type === 'asset' || type === 'liability'

  function submit(e: FormEvent) {
    e.preventDefault()
    if (openingCents === null) return
    create.mutate(
      {
        name: name.trim(),
        type,
        parentId,
        ...(showOpening &&
          openingCents !== 0 && {
            openingBalanceCents: openingCents,
            openingDate,
          }),
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit} className="card mb-6 space-y-4">
      <h2 className="font-medium">New account</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            required
            autoFocus
          />
        </label>
        <label className="block space-y-1">
          <span className="label">Type</span>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as AccountType)
              setParentId(null) // a parent must be the same type
            }}
            className="input"
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="label">Parent (optional)</span>
          <AccountPicker
            value={parentId}
            onChange={setParentId}
            types={[type]}
            allowNone
            placeholder="None (top level)"
          />
        </label>
        {showOpening && (
          <>
            <label className="block space-y-1">
              <span className="label">{OPENING_LABEL[type]} (optional)</span>
              <MoneyInput
                value={opening}
                onChange={setOpening}
                placeholder="0.00"
              />
            </label>
            <label className="block space-y-1">
              <span className="label">As of</span>
              <input
                type="date"
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
                className="input"
              />
            </label>
            <p className="text-xs text-zinc-500 sm:col-span-2">
              The starting balance is recorded as an opening entry (hidden from
              the register by default), so tracking starts from today's real
              balance.
            </p>
          </>
        )}
      </div>
      {create.error && (
        <p className="text-sm text-red-600">{create.error.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn">
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending || openingCents === null}
          className="btn-primary"
        >
          Create account
        </button>
      </div>
    </form>
  )
}

function EditAccountForm({
  account,
  onDone,
}: {
  account: AccountNode
  onDone: () => void
}) {
  const [name, setName] = useState(account.name)
  const [parentId, setParentId] = useState<number | null>(account.parentId)
  // The opening balance is shown in natural sign, the same way it's entered on create.
  const initialOpening =
    account.openingBalanceCents === null
      ? ''
      : centsToInput(toNatural(account.openingBalanceCents, account.type))
  const [opening, setOpening] = useState(initialOpening)
  const [openingDate, setOpeningDate] = useState(
    account.openingDate ?? todayLocal(),
  )
  const update = useUpdateAccount()
  const del = useDeleteAccount()
  const error = update.error ?? del.error
  const showOpening = account.type === 'asset' || account.type === 'liability'
  // Blank means no opening balance (0 removes an existing one).
  const openingCents = opening.trim() ? parseMoney(opening) : 0
  const openingChanged =
    opening !== initialOpening ||
    (account.openingDate !== null && openingDate !== account.openingDate)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (openingCents === null) return
    update.mutate(
      {
        id: account.id,
        name: name.trim(),
        parentId,
        // Only sent when changed, so saving a rename never touches the opening entry.
        ...(showOpening &&
          openingChanged && { openingBalanceCents: openingCents, openingDate }),
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit} className="card mb-6 space-y-4">
      <h2 className="font-medium">Edit {account.path}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="label">Parent</span>
          <AccountPicker
            value={parentId}
            onChange={setParentId}
            types={[account.type]}
            excludeId={account.id}
            allowNone
            placeholder="None (top level)"
          />
        </label>
        {showOpening && (
          <>
            <label className="block space-y-1">
              <span className="label">
                {account.type === 'liability'
                  ? 'Starting amount owed'
                  : 'Starting balance'}
              </span>
              <MoneyInput
                value={opening}
                onChange={setOpening}
                placeholder="0.00"
              />
            </label>
            <label className="block space-y-1">
              <span className="label">As of</span>
              <input
                type="date"
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
                className="input"
              />
            </label>
            <p className="text-xs text-zinc-500 sm:col-span-2">
              What the account held (or owed) when you started tracking it.
              Clear the field to remove the starting balance.
            </p>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              update.mutate(
                { id: account.id, archived: !account.archived },
                { onSuccess: onDone },
              )
            }
            className="btn"
          >
            {account.archived ? 'Unarchive' : 'Archive'}
          </button>
          {!account.systemKey && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete "${account.path}"?`))
                  del.mutate(account.id, { onSuccess: onDone })
              }}
              className="btn-danger"
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className="btn">
            Cancel
          </button>
          <button
            type="submit"
            disabled={update.isPending || openingCents === null}
            className="btn-primary"
          >
            Save
          </button>
        </div>
      </div>
    </form>
  )
}

export default function AccountsPage() {
  const { flat, isPending, error } = useAccounts()
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<'new' | number | null>(null)
  const editingAccount =
    typeof editing === 'number' ? flat.find((a) => a.id === editing) : undefined

  return (
    <div>
      <LedgerTabs />
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Accounts</h1>
        <button onClick={() => setEditing('new')} className="btn-primary">
          + New account
        </button>
      </header>

      {editing === 'new' && <NewAccountForm onDone={() => setEditing(null)} />}
      {editingAccount && (
        <EditAccountForm
          key={editingAccount.id}
          account={editingAccount}
          onDone={() => setEditing(null)}
        />
      )}

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived
      </label>

      {isPending && <p className="text-sm text-zinc-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <div className="space-y-6">
        {ACCOUNT_TYPES.map((type) => {
          const rows = flat.filter(
            (a) => a.type === type && (showArchived || !a.archived),
          )
          if (rows.length === 0) return null
          const total = flat
            .filter((a) => a.type === type && a.depth === 0)
            .reduce((s, a) => s + a.totalCents, 0)
          return (
            <section key={type} className="card">
              <div className="mb-2 flex justify-between font-medium">
                <h2>{ACCOUNT_TYPE_LABELS[type]}</h2>
                <Amount cents={toNatural(total, type)} />
              </div>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rows.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 py-2">
                    <Link
                      to={`/ledger/accounts/${a.id}`}
                      className={`min-w-0 flex-1 truncate hover:underline ${a.archived ? 'text-zinc-400 line-through' : ''}`}
                      style={{ paddingLeft: `${a.depth * 1.25}rem` }}
                    >
                      {a.name}
                    </Link>
                    <Amount
                      cents={toNatural(a.totalCents, type)}
                      tone
                      className="text-sm"
                    />
                    <button
                      onClick={() => setEditing(a.id)}
                      className="btn px-2 py-0.5 text-xs"
                    >
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
