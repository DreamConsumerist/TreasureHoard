// Price-sync shapes returned by /api/prices, shared with the frontend.

export interface SyncRunOut {
  id: number
  trigger: string
  status: 'running' | 'ok' | 'partial' | 'failed'
  startedAt: string
  finishedAt: string | null
  okCount: number
  failedCount: number
  error: string | null
}

export interface SyncJobStatus {
  job: 'tcg' | 'games'
  /** Whether you own anything this job prices. */
  hasTargets: boolean
  last: SyncRunOut | null
  lastSuccessAt: string | null
  /** Owned things to price, and no successful run recently enough. */
  stale: boolean
}
