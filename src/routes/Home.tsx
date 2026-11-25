import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.ts'

type Health = { db: 'ok' | 'error' }

export default function Home() {
  // GET /api/health. Also acts as the login check: a 401 redirects to /login.
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    retry: false,
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
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">TreasureHoard</h1>
        <button
          onClick={logout}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
        >
          Log out
        </button>
      </header>
      <p>
        Database: <span className={status.color}>{status.text}</span>
      </p>
    </main>
  )
}
