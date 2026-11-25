// Background function: does the slow part of a price sync.
//
// The "-background" filename suffix makes Netlify answer the caller with 202
// straight away and let this run for up to 15 minutes. It's reachable by URL
// (/.netlify/functions/price-sync-background) and not behind the /api/* edge
// auth, so it refuses any request without the sync key (lib/pricing/syncKey.ts).
//
// Callers (the API's "Refresh now" and the scheduled function) have already
// recorded the runs with startRun; this executes them one after the other.

import { db } from '../../db/index.ts'
import { executeRun } from '../../lib/pricing/sync.ts'
import { checkSyncKey, SYNC_KEY_HEADER } from '../../lib/pricing/syncKey.ts'

export default async (req: Request) => {
  const secret = process.env.SESSION_SECRET
  if (
    !secret ||
    !(await checkSyncKey(secret, req.headers.get(SYNC_KEY_HEADER)))
  ) {
    console.warn('price-sync-background: refused a request without a valid key')
    return
  }
  const body = (await req.json().catch(() => null)) as {
    runIds?: unknown
  } | null
  const runIds = Array.isArray(body?.runIds)
    ? body.runIds.filter((n): n is number => Number.isInteger(n))
    : []
  for (const runId of runIds) {
    console.log(`price-sync-background: run ${runId} starting`)
    await executeRun(db, fetch, runId)
    console.log(`price-sync-background: run ${runId} done`)
  }
}
