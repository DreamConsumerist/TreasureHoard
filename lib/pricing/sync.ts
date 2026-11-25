// Price sync: refreshes the prices of everything you own.
//
//   tcg      TCGCSV, daily. One prices file per owned set.
//   games    PriceCharting, weekly. One page per owned product, 3 s apart.
//   catalog  TCGCSV, weekly. The card search index (lib/pricing/catalog.ts):
//            new and changed sets only.
//
// A run is started in two halves so the UI sees it immediately:
//   startRun   checks the guards and records a `running` row in sync_runs
//              (done by the API or the scheduled function, both quick);
//   executeRun does the slow part (done by the background function).
// runSync does both, for scripts and tests.
//
// Each target (a set, a page) is handled on its own: a failure is recorded
// and the rest carry on. A failure never writes a $0 price, so the last good
// price stays in place. No Netlify imports: this runs anywhere with a db.

import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm'
import { cardDetails, gameDetails, items, syncRuns } from '../../db/schema.ts'
import type { Db } from '../../db/types.ts'
import {
  fetchPriceChartingPage,
  normalizePriceChartingUrl,
} from './pricecharting.ts'
import { syncCatalog } from './catalog.ts'
import { recordSnapshot } from './snapshots.ts'
import { fetchSetPrices } from './tcgcsv.ts'

export type SyncJob = 'tcg' | 'games' | 'catalog'
export type SyncTrigger = 'schedule' | 'manual'

/** A run still `running` after this long is assumed to have crashed (background limit is 15 min). */
const STUCK_AFTER_MS = 20 * 60_000
/** A manual games run is refused this soon after the last one, to stay polite to PriceCharting. */
const MANUAL_GAMES_COOLDOWN_MS = 60 * 60_000
/** Pause between PriceCharting pages. */
const PAGE_PAUSE_MS = 3000
/** How many failures are kept in sync_runs.error. */
const MAX_ERRORS = 5

export interface RunOptions {
  /** Snapshot date, 'YYYY-MM-DD'. Defaults to today's UTC date. */
  today?: string
  /** Injected so tests don't wait between pages. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const utcToday = () => new Date().toISOString().slice(0, 10)

/** Why a run can't start now, or null if it can. */
export async function startBlocker(
  db: Db,
  job: SyncJob,
  trigger: SyncTrigger,
  now = new Date(),
): Promise<string | null> {
  const [running] = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.job, job),
        eq(syncRuns.status, 'running'),
        gt(syncRuns.startedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    )
    .limit(1)
  if (running) return 'A sync of these prices is already running.'

  if (job === 'games' && trigger === 'manual') {
    const [recent] = await db
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.job, 'games'),
          gt(
            syncRuns.finishedAt,
            new Date(now.getTime() - MANUAL_GAMES_COOLDOWN_MS),
          ),
        ),
      )
      .limit(1)
    if (recent)
      return 'Game prices were refreshed less than an hour ago. PriceCharting is fetched sparingly; try again later.'
  }
  return null
}

/** Checks the guards and records a `running` run. Returns its id, or why it can't start. */
export async function startRun(
  db: Db,
  job: SyncJob,
  trigger: SyncTrigger,
): Promise<{ runId: number } | { blocked: string }> {
  const blocked = await startBlocker(db, job, trigger)
  if (blocked) return { blocked }
  const [run] = await db
    .insert(syncRuns)
    .values({ job, trigger })
    .returning({ id: syncRuns.id })
  return { runId: run!.id }
}

/** Marks a run failed outright (e.g. the background function couldn't be started). */
export async function failRun(db: Db, runId: number, message: string) {
  await db
    .update(syncRuns)
    .set({ status: 'failed', finishedAt: new Date(), error: message })
    .where(eq(syncRuns.id, runId))
}

interface Outcome {
  ok: number
  failed: number
  errors: string[]
}

/** Does the work for a run recorded by startRun, and records how it went. */
export async function executeRun(
  db: Db,
  fetchFn: typeof fetch,
  runId: number,
  options: RunOptions = {},
): Promise<void> {
  const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
  if (!run || run.status !== 'running') return // unknown or already finished

  const today = options.today ?? utcToday()
  const sleep = options.sleep ?? defaultSleep
  const outcome: Outcome = { ok: 0, failed: 0, errors: [] }
  try {
    if (run.job === 'tcg') await syncTcg(db, fetchFn, today, outcome)
    else if (run.job === 'games')
      await syncGames(db, fetchFn, today, sleep, outcome)
    else await syncCatalog(db, fetchFn, sleep, outcome)
  } catch (err) {
    // Something outside a single target broke (e.g. the database query).
    outcome.failed++
    outcome.errors.push(message(err))
  }
  await db
    .update(syncRuns)
    .set({
      // Nothing failing is ok, even with nothing to do (an unchanged catalog).
      status:
        outcome.failed === 0 ? 'ok' : outcome.ok === 0 ? 'failed' : 'partial',
      finishedAt: new Date(),
      okCount: outcome.ok,
      failedCount: outcome.failed,
      error: outcome.errors.slice(0, MAX_ERRORS).join('\n') || null,
    })
    .where(eq(syncRuns.id, runId))
}

/** startRun + executeRun in one go. For scripts and tests. */
export async function runSync(
  db: Db,
  fetchFn: typeof fetch,
  job: SyncJob,
  trigger: SyncTrigger,
  options: RunOptions = {},
): Promise<{ runId: number } | { blocked: string }> {
  const started = await startRun(db, job, trigger)
  if ('runId' in started) await executeRun(db, fetchFn, started.runId, options)
  return started
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

// --- Cards and sealed: TCGCSV ------------------------------------------------

async function syncTcg(
  db: Db,
  fetchFn: typeof fetch,
  today: string,
  outcome: Outcome,
) {
  // Owned products per set. Sold items are history: their prices don't matter.
  const owned = await db
    .selectDistinct({
      categoryId: cardDetails.categoryId,
      groupId: cardDetails.groupId,
      setName: cardDetails.setName,
      productId: cardDetails.tcgplayerProductId,
    })
    .from(cardDetails)
    .innerJoin(items, eq(items.id, cardDetails.itemId))
    .where(isNull(items.soldDate))

  const sets = new Map<
    string,
    {
      categoryId: number
      groupId: number
      setName: string
      products: Set<number>
    }
  >()
  for (const o of owned) {
    const k = `${o.categoryId}/${o.groupId}`
    const set = sets.get(k) ?? { ...o, products: new Set<number>() }
    set.products.add(o.productId)
    sets.set(k, set)
  }

  for (const set of sets.values()) {
    try {
      const prices = await fetchSetPrices(fetchFn, set.categoryId, set.groupId)
      // Every sub-type (Normal, Foil…) of each owned product, so a later
      // sub-type correction on an item still has a history to read.
      for (const p of prices) {
        if (!set.products.has(p.productId) || p.marketCents === null) continue
        await recordSnapshot(
          db,
          {
            source: 'tcgcsv',
            externalId: String(p.productId),
            variant: p.subType,
          },
          p.marketCents,
          today,
          true,
        )
      }
      outcome.ok++
    } catch (err) {
      outcome.failed++
      outcome.errors.push(`${set.setName}: ${message(err)}`)
    }
  }
}

// --- Games and hardware: PriceCharting --------------------------------------

async function syncGames(
  db: Db,
  fetchFn: typeof fetch,
  today: string,
  sleep: (ms: number) => Promise<void>,
  outcome: Outcome,
) {
  const owned = await db
    .selectDistinct({ url: gameDetails.pricechartingUrl })
    .from(gameDetails)
    .innerJoin(items, eq(items.id, gameDetails.itemId))
    .where(and(isNull(items.soldDate), isNotNull(gameDetails.pricechartingUrl)))
    .orderBy(gameDetails.pricechartingUrl)

  let first = true
  for (const { url } of owned) {
    if (!url) continue
    if (!first) await sleep(PAGE_PAUSE_MS)
    first = false
    try {
      const normalized = normalizePriceChartingUrl(url)
      if (!normalized) throw new Error('Not a PriceCharting product link')
      const page = await fetchPriceChartingPage(fetchFn, normalized.url)
      // Same key as priceKeyFor (lib/collection/prices.ts): the stored URL's path.
      const externalId = new URL(url).pathname
      for (const variant of ['loose', 'cib', 'new'] as const) {
        const cents = page.prices[variant]
        if (cents === null) continue
        await recordSnapshot(
          db,
          { source: 'pricecharting', externalId, variant },
          cents,
          today,
          true,
        )
      }
      // Fill in cover photos for items added before photos were saved.
      if (page.imageUrl) {
        await db
          .update(gameDetails)
          .set({ imageUrl: page.imageUrl })
          .where(
            and(
              eq(gameDetails.pricechartingUrl, url),
              isNull(gameDetails.imageUrl),
            ),
          )
      }
      outcome.ok++
    } catch (err) {
      outcome.failed++
      outcome.errors.push(`${new URL(url).pathname}: ${message(err)}`)
    }
  }
}

// --- Status ------------------------------------------------------------------

/** Most recent run of each job, newest first. */
export async function latestRuns(db: Db) {
  return db
    .selectDistinctOn([syncRuns.job])
    .from(syncRuns)
    .orderBy(syncRuns.job, desc(syncRuns.startedAt), desc(syncRuns.id))
}

/** When each job last finished with at least some prices updated. */
export async function lastSuccess(db: Db, job: SyncJob): Promise<Date | null> {
  const [row] = await db
    .select({ at: syncRuns.finishedAt })
    .from(syncRuns)
    .where(
      and(eq(syncRuns.job, job), sql`${syncRuns.status} in ('ok', 'partial')`),
    )
    .orderBy(desc(syncRuns.finishedAt))
    .limit(1)
  return row?.at ?? null
}
