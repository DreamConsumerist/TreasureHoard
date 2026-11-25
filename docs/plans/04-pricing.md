# Step 4 — Pricing

**Status:** approved 2026-11-24

## Context

Step 3 shipped the collection. Each item's value is still the price seen **on the day it was added**, so values never move: there is no market net worth, no price history and no "this card took off". Step 4 brings values up to date automatically and shows them where they matter. Market value tracking is the reason you started this app.

On approval this is saved as `docs/plans/04-pricing.md`. The design follows what ARCHITECTURE.md already settled (scheduled function → background function, `sync_runs`, the politeness rules for PriceCharting).

**Checked 2026-11-24:**
- **Netlify:**
  - Background functions run on the free, credit-based plan, with a 15-minute limit.
  - Scheduled functions have a fixed **30 s** limit, fire **only on the published production deploy**, use UTC cron, and can't be called by URL.
  - Background functions *can* be called by URL by anyone who knows it, so they need their own guard. The edge auth only covers `/api/*`.
- **TCGCSV:**
  - Publishes its daily update at about **20:05 UTC** (`last-updated.txt`).
  - Requires an identifying User-Agent (fixed in Step 3).

**Done when:**
- Card and sealed prices refresh daily, and game and hardware prices weekly, without you doing anything.
- You can trigger a refresh by hand from Settings.
- The Dashboard headlines **market net worth**, with book net worth beside it.
- The collection shows **movers** (change over the last 7 days).
- Each item page shows a **price history chart**.
- Settings shows when each sync last ran, how it went, and what failed.
- Stale prices are flagged.
- Games added before Step 3's photo change pick up their cover photo on the next game sync.
- Tests pass, and the migration applies on deploy.

**Not in this step:**
- net-worth-over-time chart and reports (Step 7)
- wishlist prices (Step 6 extends the same sync)
- the local or GitHub-Action fallback runner, needed only if PriceCharting blocks Netlify's servers. The sync logic is written so it can be added later without changes.

---

## 1. Schema: `db/schema.ts` (one new migration)

```
sync_job     enum: tcg | games
sync_status  enum: running | ok | partial | failed

sync_runs
  id, job sync_job, trigger text ('schedule' | 'manual'),
  started_at timestamptz default now(), finished_at timestamptz null,
  status sync_status default 'running',
  ok_count int default 0, failed_count int default 0,
  error text null          -- first few failures, one per line, for Settings
```

No changes to `price_snapshots`; the sync writes the same rows that Step 3's lookups write.

## 2. Sync logic: `lib/pricing/sync.ts` (no Netlify imports; tested with PGlite and a fake fetch)

`runSync(db, fetchFn, job, { trigger, today, sleep })`:
1. **Start.** Insert a `sync_runs` row with status `running`.
2. **Do the work.** Each target is handled on its own, so one failure doesn't stop the rest.
3. **Finish.** Write `ok` / `partial` / `failed`, the counts and the errors.

**`tcg` job**
- **Targets:** distinct (`category_id`, `group_id`) over **unsold** card and sealed items.
- For each set:
  - Fetch **only the prices file** (`/prices`, about 185 KB for a large set). Products are already stored.
  - Requests run one at a time with the existing retry (`getResults` in `lib/pricing/tcgcsv.ts`, exported for this).
- Write a snapshot for **every sub-type of every owned product** (Normal and Foil both), so later edits to the sub-type still have history.
- A null market price is skipped, and the last good price stays.

**`games` job**
- **Targets:** distinct `pricecharting_url` over unsold game and hardware items.
- **Fetching:** `fetchPriceChartingPage` (existing), one at a time with a **3 s pause** between pages. ARCHITECTURE.md promises politeness.
- **Writing:** a snapshot for each of loose, CIB and new that has a price, keyed by the URL path (`normalizePriceChartingUrl`).
- **Photos:** fills `game_details.image_url` where it's null, which backfills games added before photos existed.
- **Errors:** a parse failure (markup change) is recorded as that target's error. It is **never** recorded as a $0 price.

**Writes**
- Uses `insert … on conflict (source, external_id, variant, as_of) do update`. A second run on the same day replaces that day's price; it doesn't duplicate it.
  - Step 3's lookups use `do nothing` and stay that way: a sync's data is newer than what you saw at lookup earlier that day.

**Snapshot date** is the run's **UTC date**. At 21:00 UTC that is the same calendar day everywhere in the US.

**Guards**
- A job **won't start** while another run of the same job started less than 20 minutes ago and is still `running`. That's longer than the 15-minute background limit, so a crashed run can't block syncing forever.
- A **manual** `games` run is refused if the last games run finished **under an hour** ago. This keeps an itchy refresh button from hammering PriceCharting.

## 3. Netlify functions

| File | What it is |
|---|---|
| `netlify/functions/price-sync-background.mts` | **Background function.** The `-background` filename suffix tells Netlify to answer 202 at once and keep running for up to 15 minutes. Checks the `x-sync-key` header, then calls `runSync(db, fetch, job)` for each job in the request body. |
| `netlify/functions/price-sync-schedule.mts` | **Scheduled function**, `schedule: '0 21 * * *'` (daily at 21:00 UTC, about an hour after TCGCSV's update). Calls the background function with `{jobs: ['tcg']}`, adding `'games'` on **Mondays** (weekly). It only triggers the work, well inside its 30 s limit. |

**The guard key** is derived from the existing `SESSION_SECRET` by HMAC-SHA256 (Web Crypto) over the string `"price-sync"`: `lib/pricing/syncKey.ts`.
- **Why derived:** no new environment variable to set, and the derived key is useless for forging sessions.
- **Alternative:** a separate `SYNC_SECRET`. That's one more secret to set in Netlify for no added safety.

**How the scheduled function finds the site:** it calls its own site's background function at `/.netlify/functions/price-sync-background`, using the site URL from Netlify's function context (`context.site.url`, to confirm during implementation).

## 4. API (`lib/api/prices/*.ts`, mounted in `lib/api/app.ts`)

| Method & path | Does |
|---|---|
| `GET /api/prices/status` | Latest run per job (status, times, counts, errors), plus a `stale` flag per job: tcg older than **2 days**, games older than **8 days**. Also whether there's anything to sync. |
| `POST /api/prices/sync` `{job}` | **Refresh now.** Checks the guards above (409 with the reason), then calls the background function on the same origin with the key. Returns 202 at once, and the Settings card polls the status endpoint. Locally, `netlify dev` serves background functions, so the button works in `npm run dev`. |
| `GET /api/items` (existing) | Each item gains `weekAgoPriceCents`: the latest snapshot dated **at least 7 days before** its latest one, or null if there's no such snapshot yet. That lets the UI show movers. |
| `GET /api/dashboard` (existing) | Adds `collectionMarketCents`, `marketNetWorthCents` and `movers` (top 5 unsold items by the absolute 7-day change in their total value). |

**Market value rules** (shared helper in `lib/collection/valuation.ts`, unit-tested):
- An item's market value = latest unit price × quantity.
- **An item that has never been priced counts at its cost**, so adding something unlisted doesn't drop your net worth.
- Market net worth = book net worth − collection at cost + collection market value. This is the formula in ARCHITECTURE.md.
- **The ledger is untouched:** market value lives only in snapshots.

**Refactor (called out, not silent):** the "latest snapshot per key" query moves out of `lib/api/collection/items.ts` into `lib/api/collection/common.ts`, so the item list and the dashboard share it. It becomes one SQL query that also returns the week-ago price.

## 5. Frontend

- **Dashboard:**
  - Headline is **Market net worth**, with "Book (at cost)" underneath.
  - The Collection stat shows market value, with unrealized gain and cost in small text.
  - A **Movers** card shows the top 5 changes over 7 days, each with its thumbnail and linked to its item.
  - A stale-prices notice appears when a sync is overdue or has failed, linking to Settings.
- **Collection page:**
  - Each tile and row shows a small **7-day change** (▲ $12.40, or ▼) next to its value, when known.
  - A new sort option, **Biggest movers**.
  - The summary says "prices as of" from the latest sync.
- **Item page:** a **price history chart** for one unit's price over time, with the cost basis per unit drawn as a dashed line. Hovering shows the date and price.
- **Settings:** a **Price sync** card with one line per job, for example "Card prices: synced today 21:00 · 214 updated" or "partial: 2 failed". Errors expand underneath. A **Refresh now** button per job shows its progress until the run finishes.
- New hooks in `src/lib/queries.ts`: `usePriceStatus` (polls every 3 s while a run is `running`) and `useStartSync`.

**New library: Recharts.** It's a React charting library built on SVG, and it was already chosen in ARCHITECTURE.md. It's used here only for the item price chart; Step 7's reports reuse it. Its React 19 support is to be confirmed at install. The fallback is a small hand-drawn SVG line, which is fine for one chart.

## 6. Tests

| File | Covers |
|---|---|
| `tests/pricing/sync.test.ts` | Runs `runSync` against PGlite with a fake fetch. **tcg:** only owned sets are fetched; all sub-types of owned products are written; a null price is skipped; a same-day re-run updates rather than duplicates. **games:** one fetch per distinct URL, with the pause injected so tests don't wait; the photo is backfilled; a parse failure is recorded with no $0 snapshot, and the run is `partial` while others still succeed. **Guards:** running job, manual games cooldown. Sold items are ignored. |
| `tests/collection/valuation.test.ts` | Market value with unpriced items at cost; market net worth; 7-day change |
| `tests/api/prices.test.ts` | Status endpoint and stale flags. Manual sync: refused while running (409), calls the background URL with the key (via fake fetch). Dashboard market fields and movers. Items' `weekAgoPriceCents`. |
| `tests/pricing/syncKey.test.ts` | Deterministic key; wrong key rejected |

## 7. Files

**New**
- `lib/pricing/sync.ts`, `lib/pricing/syncKey.ts`
- `lib/collection/valuation.ts`
- `lib/api/prices/{status,sync}.ts`
- `netlify/functions/price-sync-background.mts`, `netlify/functions/price-sync-schedule.mts`
- `src/components/PriceChart.tsx`, `src/components/PriceChange.tsx`
- the migration folder
- the four test files
- `docs/plans/04-pricing.md`

**Modified**
- `db/schema.ts`
- `lib/pricing/tcgcsv.ts` (export the prices fetch)
- `lib/api/collection/{common,items}.ts`
- `lib/api/ledger/dashboard.ts`
- `lib/api/app.ts`
- `lib/collection/types.ts`, `lib/ledger/types.ts`
- `src/lib/queries.ts`
- `src/routes/{Dashboard,Collection,ItemPage,Settings}.tsx`
- `src/components/ItemList.tsx`
- `package.json` (recharts)
- `ARCHITECTURE.md`: sync schedule, guard key, market-value rule for unpriced items, and file names (`price-sync-*` instead of the placeholder `sync-tcg-prices` / `schedules`)

## 8. Credit cost (free plan: 300/month)

- **Function compute:**
  - Daily card sync: about 1–2 s per owned set, so well under a minute.
  - Weekly game sync: about 4 s per game.
  - Total: a fraction of 1 GB-hour a month, so **under 5 credits**.
- **Database:** **one extra wake per day** (about 30 a month). This is the main unknown, as ARCHITECTURE.md already says.
- **Check:** look at Netlify's usage page two weeks after deploy.
- **Fallback if it runs high:** change the cron to every other day, a one-line change.

## 9. Order

1. Schema and migration, then `syncKey` and `valuation` with their tests.
2. `runSync` with its tests.
3. Functions and the prices API, plus the dashboard and items changes, with their tests.
4. Frontend: Settings card first (so a sync can be triggered locally), then Dashboard, Collection, and the item chart.
5. You check it. Then commit, and push when you say.

## 10. Verification

- `npm test`, `npm run build`, `npm run lint`; `db:migrate` locally.
- **I'll run the sync logic against the real sources** once, through a scratch script against your local database (like the TCGCSV check before), with any items you've added locally as targets. I'll report the counts. This only reads public prices; I won't start a dev server.
- **Manual, in your `npm run dev`:**
  1. Settings → Price sync → **Refresh now** for cards, then for games. Both should finish and show counts.
  2. A game added before the photo change gets its cover photo.
  3. The Dashboard shows market and book net worth. An unpriced item doesn't lower the market figure.
  4. The item page shows the chart (one or two points so far; movers appear once 7 days of history exist).
- **After deploy:**
  - the migration is applied
  - the Netlify UI lists `price-sync-schedule` as scheduled
  - next day, Settings shows a scheduled run
  - to test sooner, use **Run now** on the scheduled function in the Netlify UI
