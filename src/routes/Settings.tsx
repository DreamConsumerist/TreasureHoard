// Settings: system status, price sync health, the collection check, and log
// out. Import arrives in a later step.

import { useQuery } from '@tanstack/react-query'
import { formatMoney } from '../../lib/ledger/money.ts'
import { PriceSyncCard } from '../components/PriceSync.tsx'
import { api } from '../lib/api.ts'
import { useCollectionCheck } from '../lib/queries.ts'

export default function Settings() {
  const check = useCollectionCheck()
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ db: string }>('/health'),
  })

  async function logout() {
    await api('/logout', { method: 'POST' })
    window.location.assign('/login')
  }

  const status = health.isPending
    ? { text: 'checking…', color: 'text-zinc-500' }
    : health.data?.db === 'ok'
      ? { text: 'connected', color: 'text-green-600' }
      : { text: health.error?.message ?? 'error', color: 'text-red-600' }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <section className="card space-y-2">
        <h2 className="font-medium">System</h2>
        <p className="text-sm">
          Database: <span className={status.color}>{status.text}</span>
        </p>
      </section>
      <PriceSyncCard />
      <section className="card space-y-2">
        <h2 className="font-medium">Collection check</h2>
        {check.isPending && <p className="text-sm text-zinc-500">Checking…</p>}
        {check.error && (
          <p className="text-sm text-red-600">{check.error.message}</p>
        )}
        {check.data &&
          (check.data.ok ? (
            <p className="text-sm text-green-600">
              ✓ The Collection account matches your items (
              {formatMoney(check.data.ledgerCents)} at cost).
            </p>
          ) : (
            <p className="text-sm text-red-600">
              Mismatch: the Collection account holds{' '}
              {formatMoney(check.data.ledgerCents)}, but unsold items cost{' '}
              {formatMoney(check.data.itemsCents)}. Something changed the books
              outside the collection pages.
            </p>
          ))}
        <p className="text-xs text-zinc-500">
          The Collection account should always equal the total cost of the items
          you still own.
        </p>
      </section>
      <button onClick={logout} className="btn">
        Log out
      </button>
    </div>
  )
}
