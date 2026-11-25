// The frame around every logged-in page: a sidebar on desktop, a bottom tab
// bar on phones, and the quick-add sheet that the "Add" tab opens from anywhere.

import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { QuickAddContext } from '../lib/quickAdd.ts'
import { TransactionForm } from './TransactionForm.tsx'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/ledger', label: 'Ledger', end: false },
  // Collection arrives in Step 3.
]

const sideLink = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm ${
    isActive
      ? 'bg-zinc-200 font-medium dark:bg-zinc-800'
      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
  }`

const tabLink = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center py-2 text-xs ${
    isActive
      ? 'font-semibold text-zinc-900 dark:text-zinc-100'
      : 'text-zinc-500'
  }`

export function AppShell() {
  const [open, setOpen] = useState(false)
  // Remounts the form each time the sheet opens, so it starts blank.
  const [formKey, setFormKey] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  const openQuickAdd = () => {
    setFormKey((k) => k + 1)
    setOpen(true)
  }

  return (
    <QuickAddContext.Provider value={openQuickAdd}>
      <div className="md:flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-zinc-200 p-3 md:flex dark:border-zinc-800">
          <div className="px-3 py-2 text-lg font-semibold">TreasureHoard</div>
          <button onClick={openQuickAdd} className="btn-primary mb-2 py-2">
            + New transaction
          </button>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={sideLink}>
              {n.label}
            </NavLink>
          ))}
          <div className="flex-1" />
          <NavLink to="/settings" className={sideLink}>
            Settings
          </NavLink>
        </aside>

        <main className="mx-auto w-full max-w-4xl flex-1 p-4 pb-24 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 flex border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-zinc-800 dark:bg-zinc-950">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={tabLink}>
            {n.label}
          </NavLink>
        ))}
        <button onClick={openQuickAdd} className={tabLink({ isActive: false })}>
          <span className="text-lg leading-none">+</span>
          Add
        </button>
      </nav>

      {/* Quick-add sheet: a full-width bottom sheet on phones, a centered dialog on desktop */}
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 text-inherit backdrop:bg-black/40 md:m-auto md:max-w-lg md:rounded-2xl dark:bg-zinc-900"
      >
        <div className="max-h-[90dvh] overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">New transaction</h2>
            <button
              onClick={() => setOpen(false)}
              className="btn"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {open && (
            <TransactionForm
              key={formKey}
              autoFocus
              onSaved={() => {
                setOpen(false)
              }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              navigate('/ledger/new')
            }}
            className="mt-3 text-sm text-zinc-500 underline"
          >
            Open full page
          </button>
        </div>
      </dialog>
    </QuickAddContext.Provider>
  )
}

/** Sub-tabs shared by the Ledger pages. */
export function LedgerTabs() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm ${
      isActive
        ? 'bg-zinc-200 font-medium dark:bg-zinc-800'
        : 'text-zinc-600 dark:text-zinc-400'
    }`
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto">
      <NavLink to="/ledger" end className={tab}>
        Register
      </NavLink>
      <NavLink to="/ledger/accounts" className={tab}>
        Accounts
      </NavLink>
    </div>
  )
}
