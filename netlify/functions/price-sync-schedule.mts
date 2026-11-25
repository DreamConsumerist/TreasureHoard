// Scheduled function: kicks off the price sync. It only records the runs and
// hands them to the background function, well inside the 30 s limit for
// scheduled functions.
//
//   Daily at 21:00 UTC (about an hour after TCGCSV's ~20:05 UTC update):
//   card and sealed prices. On Mondays, game and hardware prices too.
//
// Scheduled functions only fire on the published production deploy. To run
// it sooner, use "Run now" on this function in the Netlify UI.

import type { Config, Context } from '@netlify/functions'
import { db } from '../../db/index.ts'
import { failRun, startRun, type SyncJob } from '../../lib/pricing/sync.ts'
import { triggerBackground } from '../../lib/pricing/trigger.ts'

export default async (_req: Request, context: Context) => {
  const secret = process.env.SESSION_SECRET
  const origin = context.site?.url ?? process.env.URL
  if (!secret || !origin) {
    console.error('price-sync-schedule: missing SESSION_SECRET or site URL')
    return
  }

  const jobs: SyncJob[] = ['tcg']
  if (new Date().getUTCDay() === 1) jobs.push('games') // Monday

  const runIds: number[] = []
  for (const job of jobs) {
    const started = await startRun(db, job, 'schedule')
    if ('blocked' in started)
      console.log(`price-sync-schedule: ${job} skipped: ${started.blocked}`)
    else runIds.push(started.runId)
  }
  if (runIds.length === 0) return

  try {
    await triggerBackground(fetch, origin, secret, runIds)
  } catch (err) {
    const msg = `Couldn't start the sync: ${err instanceof Error ? err.message : String(err)}`
    console.error(`price-sync-schedule: ${msg}`)
    for (const id of runIds) await failRun(db, id, msg)
  }
}

export const config: Config = {
  schedule: '0 21 * * *',
}
