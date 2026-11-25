// Price-sync health: the Settings card (last run per job, errors, Refresh now)
// and the Dashboard's stale-prices notice.

import { Link } from 'react-router'
import {
  usePriceStatus,
  useStartSync,
  type SyncJobStatus,
} from '../lib/queries.ts'

const JOB_LABELS = {
  tcg: {
    name: 'Card & sealed prices',
    source: 'TCGCSV',
    schedule: 'daily',
    unit: 'set',
  },
  games: {
    name: 'Game & hardware prices',
    source: 'PriceCharting',
    schedule: 'weekly (Mondays)',
    unit: 'page',
  },
  catalog: {
    name: 'Card search index',
    source: 'TCGCSV',
    schedule: 'weekly (Mondays), changed sets only',
    unit: 'set',
  },
} as const

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

function JobLine({ s }: { s: SyncJobStatus }) {
  const start = useStartSync()
  const label = JOB_LABELS[s.job]
  const run = s.last
  const running = run?.status === 'running'
  const plural = (n: number) => `${n} ${label.unit}${n === 1 ? '' : 's'}`

  let summary: { text: string; color: string }
  if (!run) summary = { text: 'never synced', color: 'text-zinc-500' }
  else if (running)
    summary = {
      text: `syncing… (started ${when(run.startedAt)})`,
      color: 'text-zinc-500',
    }
  else if (run.status === 'ok')
    summary = {
      text: `✓ ${when(run.finishedAt ?? run.startedAt)} · ${plural(run.okCount)} updated`,
      color: 'text-green-600',
    }
  else if (run.status === 'partial')
    summary = {
      text: `${when(run.finishedAt ?? run.startedAt)} · ${plural(run.okCount)} updated, ${run.failedCount} failed`,
      color: 'text-amber-600',
    }
  else
    summary = {
      text: `Failed ${when(run.finishedAt ?? run.startedAt)}`,
      color: 'text-red-600',
    }

  return (
    <div className="space-y-1 border-t border-zinc-200 pt-3 first:border-t-0 first:pt-0 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{label.name}</div>
          <div className="text-xs text-zinc-500">
            {label.source}, {label.schedule}
            {run?.trigger === 'manual' && !running ? ' · last run by hand' : ''}
          </div>
          <div className={`text-sm ${summary.color}`}>{summary.text}</div>
          {s.stale && !running && (
            <div className="text-xs text-amber-600">
              Prices are out of date
              {s.lastSuccessAt
                ? ` (last updated ${when(s.lastSuccessAt)})`
                : ''}
              .
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn shrink-0"
          disabled={running || start.isPending || !s.hasTargets}
          title={s.hasTargets ? undefined : 'Nothing owned to price yet'}
          onClick={() => start.mutate(s.job)}
        >
          {running ? 'Syncing…' : 'Refresh now'}
        </button>
      </div>
      {run?.error && !running && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">What failed</summary>
          <pre className="mt-1 whitespace-pre-wrap">{run.error}</pre>
        </details>
      )}
      {start.error && (
        <p className="text-sm text-red-600">{start.error.message}</p>
      )}
    </div>
  )
}

export function PriceSyncCard() {
  const status = usePriceStatus()
  return (
    <section className="card space-y-3">
      <h2 className="font-medium">Price sync</h2>
      {status.isPending && <p className="text-sm text-zinc-500">Loading…</p>}
      {status.error && (
        <p className="text-sm text-red-600">{status.error.message}</p>
      )}
      {status.data?.map((s) => (
        <JobLine key={s.job} s={s} />
      ))}
      <p className="text-xs text-zinc-500">
        Syncs run on their own on the live site (21:00 UTC). In local
        development, use Refresh now.
      </p>
    </section>
  )
}

/** A one-line warning when owned prices are overdue, or nothing at all. */
export function StalePricesNotice() {
  const status = usePriceStatus()
  const stale = status.data?.filter(
    (s) => s.stale && s.last?.status !== 'running',
  )
  if (!stale?.length) return null
  return (
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {stale.map((s) => JOB_LABELS[s.job].name).join(' and ')}{' '}
      {stale.length === 1 ? 'is' : 'are'} out of date.{' '}
      <Link to="/settings" className="font-medium underline">
        Check the price sync
      </Link>
    </p>
  )
}
