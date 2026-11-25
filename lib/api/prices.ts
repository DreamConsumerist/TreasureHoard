// /api/prices: price-sync health and "Refresh now".

import { and, count, eq, isNotNull, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { cardDetails, gameDetails, items } from '../../db/schema.ts'
import type { Db } from '../../db/types.ts'
import {
  failRun,
  lastSuccess,
  latestRuns,
  startRun,
  type SyncJob,
} from '../pricing/sync.ts'
import { triggerBackground } from '../pricing/trigger.ts'
import type { SyncJobStatus } from '../pricing/types.ts'
import { fail, validate } from './errors.ts'

const DAY_MS = 24 * 60 * 60_000
/** Prices older than this are flagged as stale. A day of slack over each schedule. */
const STALE_AFTER_MS: Record<SyncJob, number> = {
  tcg: 2 * DAY_MS,
  games: 8 * DAY_MS,
  catalog: 8 * DAY_MS,
}

const syncStartSchema = z.object({ job: z.enum(['tcg', 'games', 'catalog']) })

async function targetCount(db: Db, job: SyncJob): Promise<number> {
  if (job === 'catalog') return 1 // the index covers every set, owned or not
  const [row] =
    job === 'tcg'
      ? await db
          .select({ n: count() })
          .from(cardDetails)
          .innerJoin(items, eq(items.id, cardDetails.itemId))
          .where(isNull(items.soldDate))
      : await db
          .select({ n: count() })
          .from(gameDetails)
          .innerJoin(items, eq(items.id, gameDetails.itemId))
          .where(
            and(
              isNull(items.soldDate),
              isNotNull(gameDetails.pricechartingUrl),
            ),
          )
  return row?.n ?? 0
}

export function priceRoutes(db: Db, fetchFn: typeof fetch) {
  const r = new Hono()

  // GET /api/prices/status → one entry per job.
  r.get('/status', async (c) => {
    const runs = await latestRuns(db)
    const now = Date.now()
    const out: SyncJobStatus[] = []
    for (const job of ['tcg', 'games', 'catalog'] as const) {
      const run = runs.find((x) => x.job === job)
      const success = await lastSuccess(db, job)
      const hasTargets = (await targetCount(db, job)) > 0
      out.push({
        job,
        hasTargets,
        last: run
          ? {
              id: run.id,
              trigger: run.trigger,
              status: run.status,
              startedAt: run.startedAt.toISOString(),
              finishedAt: run.finishedAt?.toISOString() ?? null,
              okCount: run.okCount,
              failedCount: run.failedCount,
              error: run.error,
            }
          : null,
        lastSuccessAt: success?.toISOString() ?? null,
        // A never-built index isn't "stale": the search box offers to build it.
        stale:
          hasTargets &&
          (job === 'catalog' ? Boolean(success) : true) &&
          (!success || now - success.getTime() > STALE_AFTER_MS[job]),
      })
    }
    return c.json(out)
  })

  // POST /api/prices/sync { job } → records the run, then hands it to the
  // background function. Answers 202 at once; poll /status for progress.
  r.post('/sync', validate('json', syncStartSchema), async (c) => {
    const { job } = c.req.valid('json')
    const secret = process.env.SESSION_SECRET
    if (!secret) fail(500, 'Server is missing SESSION_SECRET')
    const started = await startRun(db, job, 'manual')
    if ('blocked' in started) fail(409, started.blocked)
    try {
      await triggerBackground(fetchFn, new URL(c.req.url).origin, secret, [
        started.runId,
      ])
    } catch (err) {
      const msg = `Couldn't start the sync: ${err instanceof Error ? err.message : String(err)}`
      await failRun(db, started.runId, msg)
      fail(502, msg)
    }
    return c.json({ runId: started.runId }, 202)
  })

  return r
}
