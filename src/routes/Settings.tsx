// Settings: system status and log out. Price sync health, overrides and
// import arrive in later steps.

import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.ts'

export default function Settings() {
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
      <button onClick={logout} className="btn">
        Log out
      </button>
    </div>
  )
}
