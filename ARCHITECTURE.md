# Architecture

TreasureHoard is a personal finance app for a single user. It has two jobs:

1. **General ledger:** double-entry bookkeeping for personal spending.
2. **Collection valuation:** an inventory of trading cards and video games, with market prices tracked over time.

The app will not be distributed, so there's no multi-tenancy or onboarding. It is still deployed at a public URL and holds financial data, so it sits behind authentication.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript 6.0 throughout (strict) | Frontend, functions and schema share types. Pinned to 6.0: Netlify CLI's function bundler loads TypeScript's JS API, which TypeScript 7 (the Go port) doesn't provide |
| Lint / format | oxlint, Prettier | oxlint is the Vite template's default (Rust-based, fast) |
| Frontend | React + Vite SPA | TanStack Query (data), Tailwind CSS (styling), Recharts (charts) |
| Mobile | Responsive layout + PWA (`vite-plugin-pwa`) | Installable to the phone home screen |
| API | Netlify Functions | One REST router at `/api/*` |
| Jobs | Netlify Scheduled Functions → Background Functions | Scheduled functions have a 30 s limit, so each one only kicks off a background function (15 min limit) that does the work |
| Auth | Netlify Edge Function | Single hashed password in an env var; signed session cookie |
| Database | Netlify Database (Postgres, `@netlify/database`) | Drizzle ORM (`drizzle-orm/netlify-db`) for schema and queries; drizzle-kit generates SQL migrations that Netlify applies on deploy |
| Card prices | TCGCSV (tcgcsv.com) | Daily dump of TCGplayer prices; TCGplayer's own API is closed to new developers |
| Game prices | PriceCharting, scraped | Parsed with `cheerio`. Their API costs $50/month, too much for personal use |

## System overview

```
Browser / phone (React SPA, PWA)
   │  fetch /api/*
   ▼
Edge Function: auth gate ── rejects requests without a valid session
   ▼
Netlify Functions (api) ───────► Netlify Database (Postgres)
                                     ▲
Background Function ─────────────────┘
   price-sync-background   executes recorded sync runs (tcg: TCGCSV, games: PriceCharting)
        ▲  POST + x-sync-key
        ├─ Scheduled Function price-sync-schedule: daily 21:00 UTC (tcg; + games on Mondays)
        └─ API POST /api/prices/sync ("Refresh now" in Settings)
```

- **Two halves:** the caller records the run in `sync_runs` (`startRun`: guards, then a `running` row) and hands its id to the background function, which does the slow part (`executeRun`). The run is visible in Settings immediately. Scheduled functions have a fixed 30 s limit; background functions get 15 minutes.
- **Sync key:** background functions are reachable by URL and aren't behind the `/api/*` edge auth, so `price-sync-background` refuses requests without the `x-sync-key` header: HMAC-SHA256 of `SESSION_SECRET` over a fixed label (`lib/pricing/syncKey.ts`). No extra environment variable; the key can't be turned back into the secret.
- **Guards:** a job won't start while a run of it started under 20 minutes ago is still `running` (longer than the 15-minute background limit, so a crashed run can't block syncing). A manual games refresh is refused within an hour of the last one.
- Scheduled functions only fire on the published production deploy, not on deploy previews or branch deploys. They can be run by hand with **Run now** in the Netlify UI. Locally, Settings → **Refresh now** runs a sync through `netlify dev`.

## Data model

### Ledger (double-entry)

- **`accounts`**: `id`, `name`, `type` (`asset` | `liability` | `equity` | `income` | `expense`), `parent_id` (for nesting, e.g. Expenses → Hobbies → Cards; same type as the parent), `system_key` (unique, nullable: a stable handle for accounts the app relies on, such as `opening_balances`; these can be renamed but not deleted), `archived`. Sibling names are unique. System accounts: `opening_balances` (Equity), the Collection accounts (Step 3), and `receivables` ("Owed to me", an asset whose sub-accounts are the people who owe you money).
- **`transactions`**: `id`, `date`, `description`, `notes`, `status` (`pending` | `cleared`), `external_id` (unique, nullable; set by imports), `import_batch_id` (nullable), `kind` (`normal` | `opening`; opening-balance entries are hidden from the register by default), `recurring_template_id` and `occurrence_date` (nullable; set when a recurring template created the transaction, unique together so an occurrence can't be created twice; the link is cleared if the template is deleted).
- **`recurring_templates`**: `description`, `notes`, `frequency` (`week` | `month` | `year`), `interval` (every N), `start_date`, `end_date` (nullable), `next_index` (the next occurrence to create), `variable` (the amount is an estimate, asked for on confirm), `active` (unticked = paused). Its postings are in **`recurring_template_postings`** (`template_id`, `account_id`, `amount_cents`, `memo`), balanced by the same rules as transactions. See "Recurring transactions" below.
- **`postings`**: `id`, `transaction_id`, `account_id`, `amount_cents` (signed bigint), `memo`.
- **`import_batches`**: `id`, `source`, `filename`, `imported_at`.
- **`categorization_rules`** *(later)*: description pattern → account.

Rules:
- **Money is stored as integer cents.** Never as floats.
- **Each transaction's postings sum to zero, and there are at least two.** The API enforces this (Zod schema + `lib/ledger/postings.ts`). As a backstop, deferred constraint triggers check it at commit time (hand-written migration `ledger_integrity`), so even code that bypasses the API can't save an unbalanced transaction.
- Sign convention: positive = debit, negative = credit.
- Account balances and net worth are derived from postings, never stored. They include pending transactions; registers also show the cleared balance.
- **Cash** on the Dashboard is every asset account except the Collection and "Owed to me".

### Recurring transactions

- **Occurrence dates** are computed from the start date: occurrence *k* is start + *k* × interval, with the day clamped to the end of shorter months (`lib/ledger/recurring.ts`). Counting from the start keeps a bill due on the 31st on Feb 28 and back on Mar 31; stepping from the previous date would drift to the 28th for good.
- **Lazy generation:** no scheduled job. When the app opens, the app shell calls `POST /api/recurring/catch-up` with the browser's **local** date, and every occurrence due on or before it is created as a `pending` transaction (at most 60 per template per call). Saving a template runs it again, so past dates appear at once. Using the local date (not the server's UTC date) keeps tomorrow's bill from appearing tonight in US time zones, and nothing wakes the database on days the app isn't opened.
- **Edits apply to future occurrences only.** Transactions already created keep their amounts. A schedule change restarts counting after the last occurrence already created, so editing never re-creates a past bill. Skipping an occurrence deletes it; it isn't created again.
- **Variable bills** (utilities) are created with an estimate: the template's split scaled to the last confirmed bill's total (unless the template was edited since). Confirming asks for the real total and rescales the split: the single "paying" line becomes the total and the other lines keep their proportions, rounded with the largest-remainder method so they balance to the cent. Splits with no single paying line fall back to the full editor.
- **Money owed to you** is an ordinary asset balance under "Owed to me" (e.g. a roommate's half of a bill is posted to *Owed to me : Roommate*; their payment moves it to Checking). The Dashboard lists each non-zero balance with the last payment date and a Record payment shortcut. No aging or bill-by-bill matching.

### Inventory

- **`items`**: `id`, `kind` (`card` | `sealed` | `game` | `hardware`), `name`, `quantity`, `condition`, `cost_basis_cents` (total for the row), `basis_source` (`purchase` | `baseline`), `acquired_date`, `acquired_txn_id` (→ transactions; null only for a $0 basis, which books nothing), `sold_date` (what marks an item sold), `sold_txn_id` (null for a $0 giveaway of a $0 item), `sale_proceeds_cents`, `notes`. Both transaction links are `on delete restrict`.
- **`card_details`**: `item_id`, `category_id` and `group_id` (TCGplayer game and set, so syncs fetch only owned sets), `tcgplayer_product_id`, `sub_type` (e.g. Normal, Foil), `set_name`, `number`, `rarity`, `image_url`. Used by both `card` and `sealed`.
- **`game_details`**: `item_id`, `platform`, `pricecharting_url` (null = priced by hand), `variant` (`loose` | `cib` | `new`), `image_url` (the PriceCharting cover photo, saved when the item is added; null if none). Used by both `game` and `hardware`.
- **`wishlist_items`** *(Step 6)*: product reference (`source`, `external_id`, `variant`), `target_price_cents`, `notes`.

Collection scope: MTG, One Piece and Riftbound cards and sealed product (TCGCSV categories 1, 68, 89), plus video games, consoles and accessories (PriceCharting). No graded cards.

### Valuation

- **`price_snapshots`**: `source` (`tcgcsv` | `pricecharting` | `manual`), `external_id` (TCGplayer product ID, PriceCharting URL path, or `item:<id>` for manual), `variant` (sub-type or loose/cib/new; `''` for manual), `price_cents`, `as_of`. Created in Step 3: the price seen when an item is added is its first snapshot.
  - Unique on (`source`, `external_id`, `variant`, `as_of`).
  - Keyed by **product**, not item, so multiple copies of the same product share one price history.
  - Append-only. Supports value-over-time charts and unrealized gain/loss against cost basis.
- **`sync_runs`**: `job` (`tcg` | `games`), `trigger` (`schedule` | `manual`), `started_at`, `finished_at`, `status` (`running` | `ok` | `partial` | `failed`), `ok_count` and `failed_count` (sets or pages), `error` (first few failures). Powers Settings → Price sync and the stale-prices notice (card prices older than 2 days, game prices older than 8).

### Collection accounting

**Cost is in the ledger, and market value is in snapshots.** Price changes therefore never clutter the books.

- **Purchases are assets at cost:** debit Assets → Collection → (Cards | Sealed | Games | Hardware), credit the paying account.
- **Sales:** proceeds to the receiving account, credit Collection for the cost basis, and the difference to Income → Realized Gains on Collection. Selling part of a quantity splits the item row and prorates the basis.
- **Fresh-start baseline:** there are no purchase records for the existing collection, so items already owned are entered at their market value on the day they're added (`basis_source = baseline`). This happens through an opening-balance transaction (debit Collection, credit Equity → Opening Balances). Cash accounts likewise start at their current balances. Gains on baseline items are measured from that value. The app is for personal tracking, not taxes.
- **Invariant:** the Collection account balance equals the summed cost basis of unsold items. It's kept by construction: every collection write updates the item and its transaction together; transactions linked to items can't be edited or deleted from the ledger (409); ordinary transactions can't post to Collection accounts; and the Collection accounts can't be archived, moved, nested under, or given a starting balance. `GET /api/collection/check` (shown in Settings) verifies it.
- **Net worth comes in two forms:**
  - **book**: from the ledger, with the collection at cost
  - **market**: book − collection cost + collection market value

  The Dashboard headlines market net worth. An item's market value is its latest unit price × quantity; **an item that has never been priced counts at its cost**, so adding something unlisted doesn't lower net worth (`lib/collection/valuation.ts`).
- **Movers:** each item's 7-day change compares its latest price with the latest price dated at least 7 days before it.

## Pricing integrations

### TCGCSV (cards)
- Runs daily at 21:00 UTC, about an hour after TCGCSV's own update (~20:05 UTC). Snapshots are dated with the run's UTC date.
- Downloads only the `/prices` file, and only for sets (groups) that contain unsold owned items (wishlist entries from Step 6). Product details are stored at lookup time.
- Records every sub-type of each owned product, matched by TCGplayer product ID. A null market price is skipped, so the last good price stays.
- Sends an identifying User-Agent: TCGCSV answers 401 to requests that don't name their application.

### PriceCharting (games): scraper
Scraping is against PriceCharting's terms; for this personal, low-volume use that risk is accepted. The scraper is built to stay polite and to fail visibly:

- **Narrow scope:** fetches only the stored `pricecharting_url` of owned items and wishlist entries, plus a single page fetch when a URL is pasted in to add an item. No crawling, no search scraping.
- **Low rate:** weekly runs (Mondays), one page per owned product, 3 seconds apart; a manual refresh is refused within an hour of the last run. robots.txt allows product pages (checked by hand 2026-11-24; it only disallows checkout paths). The sync does not re-read robots.txt itself.
- **Isolated parsing:** `parsePriceChartingPage(html) → { loose, cib, new }` lives in a single module, so markup changes need a fix in one file only.
- **Visible failure:** a parse failure is logged to `sync_runs` and the last good snapshot is kept. It is never recorded as a zero price.
- **Fixture test:** saved HTML in `tests/fixtures/` catches layout changes.
- **Portable runner:** scraper logic in `lib/` has no Netlify dependencies. If Netlify's (AWS) IPs get blocked, the same code runs from a scheduled GitHub Action or locally (`scripts/scrape-local.ts`). Outside Netlify, the script connects with the production connection string (from `netlify database status --show-credentials`), stored as a GitHub Actions secret or a local git-ignored `.env`. Never committed.
- **Manual override:** any item's price can be entered by hand (`source = manual`).

## Bank import (planned)

Manual entry is the primary input. Import is added later, once the export format from Global Credit Union is known. Prefer OFX/QFX (stable `FITID`) over CSV.

- Parser interface: `parse(file) → RawTransaction[]`, one implementation per format.
- **Deduplication:** `transactions.external_id` holds the FITID, or for CSV a hash of date + amount + description. A unique constraint makes re-imports harmless.
- **Rollback:** every imported transaction references an `import_batches` row.
- **Review flow:** imported rows land as `pending` with the bank-account side filled in. The user assigns the other side (expense account), optionally helped by categorization rules.
- Real bank exports are git-ignored. Only sanitized samples go in `tests/fixtures/`.

## Security

- Edge Function gate on every `/api/*` route except `/api/login`, plus the same check repeated as middleware inside the API function (defense in depth).
- Pages and JS/CSS bundles are not gated: they contain app code only, never data. The app redirects to `/login` when the API returns 401.
- Password hash and session-signing secret live in Netlify environment variables, never in the repo.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, valid 30 days. **Sliding:** a valid session over 7 days old is re-issued for another 30 days on the next API request (`lib/auth/session.ts`, `lib/api/app.ts`), so regular use never logs you out and 30 days of disuse does. The edge function only checks validity; renewal happens in the API.
- `.env*`, `.netlify/`, and raw bank exports are git-ignored.

## Mobile UX

- On narrow screens, tables become card lists. Bottom tab bar: Dashboard, Ledger, Collection, Add. The full site map is in [docs/plans/site-map.md](docs/plans/site-map.md).
- **Quick-add:** amount (numeric keypad), payee, category, and date (defaults to today). An optional "this is a card or game" toggle also creates the inventory item, linked to the transaction.
- **Installable as a PWA** (Safari → Share → Add to Home Screen). `vite-plugin-pwa` writes `manifest.webmanifest` and a Workbox service worker (`sw.js`) at build time; it's off in development.
  - The service worker **precaches only the app's own files** (HTML, JS, CSS, icons), so the app opens fast and loads offline. **It never caches data:** `/api/*` and `/.netlify/*` are excluded from the navigation fallback and there are no runtime caching rules. Other sites' product photos use the browser's normal HTTP cache.
  - **Updates prompt:** a new deploy shows "New version · Reload" (`src/components/UpdateBar.tsx`) rather than reloading mid-entry; an open app checks hourly.
  - **iPhone:** `viewport-fit=cover` plus `env(safe-area-inset-*)` padding keeps content clear of the notch and home indicator; black status bar; form fields are 16px on phones so iOS doesn't zoom; an offline notice explains why nothing loads. An installed iPhone app keeps its own cookies, so it needs one login of its own.
  - **Icons** are generated from `public/icon.svg` by `npm run icons` (`@vite-pwa/assets-generator`) and committed. The current icon is a placeholder.

## Project layout

```
TreasureHoard/
├─ netlify.toml
├─ src/                          # React app
│  ├─ routes/                    # dashboard, ledger/*, collection/*, settings
│  └─ components/
├─ netlify/
│  ├─ functions/
│  │  ├─ api.mts                 # REST router (Hono)
│  │  ├─ price-sync-background.mts  # background function: runs price syncs
│  │  └─ price-sync-schedule.mts    # scheduled trigger (daily; games on Mondays)
│  ├─ edge-functions/auth.ts     # password gate
│  └─ database/migrations/       # SQL generated by drizzle-kit; applied by Netlify on deploy
├─ db/
│  ├─ schema.ts                  # Drizzle table definitions (source of truth)
│  └─ index.ts                   # Drizzle client
├─ lib/                          # pure logic, no Netlify dependencies
│  ├─ api/                       # Hono app: createApp(db, { fetch }) + ledger/ (incl. recurring), collection/ and prices route modules
│  ├─ collection/                # posting builders, price keys, Zod schemas, response types
│  ├─ ledger/                    # money, signs, posting rules, recurring dates and rescaling, account tree, Zod schemas, shared types
│  ├─ pricing/                   # tcgcsv, pricecharting (fetch + parse), snapshots, sync, syncKey
│  └─ import/                    # OFX / CSV parsers (later)
├─ scripts/scrape-local.ts       # fallback scraper runner
└─ tests/                        # Vitest; API tests run createApp() on in-memory PGlite with real migrations
   └─ fixtures/                  # saved HTML, sanitized bank samples
```

## Development workflow and deploys

### Environments

| Environment | Triggered by | Database | Cost |
|---|---|---|---|
| Local (`npm run dev` → `netlify dev`) | You | Local Postgres on your machine, started and stopped with the dev server | Free |
| Deploy preview / branch deploy | Push to `dev` | Its own database branch, forked from production data | Free |
| Production | Merge to `main` | Production database | 15 credits per deploy |

### Branch workflow
- Day-to-day work happens on **`dev`**. Most iteration happens locally; pushes to `dev` create free previews.
- **Merge `dev` → `main` only at milestones.** Each merge is one production deploy.

### Migrations
- `db/schema.ts` is the source of truth. `npm run db:generate` (drizzle-kit) writes the SQL into `netlify/database/migrations/`, and the files are committed.
- **On deploy, Netlify applies new migrations automatically**, just before publishing. A failed migration blocks a production deploy or fails a preview, so the previous version stays live.
- **Locally, migrations are not automatic.** Run `npm run db:migrate` (`netlify database migrations apply`) after generating. `netlify database reset` wipes the local database.
- Netlify has no down migrations. Schema changes must be backward-compatible: add first, remove later.
- Never edit a migration that has already been deployed. Write a new one instead.

### Credit budget (free plan: 300 credits/month)
If credits run out, **every site on the account is paused** until the next billing cycle, and free plans can't buy more.

| Item | Rate | Expected monthly use (estimate) |
|---|---|---|
| Production deploys | 15 credits each | 4–6 deploys → 60–90 |
| Database compute | 10 credits per compute unit (free plan cap: 48 units/month; the database sleeps after 5 min idle) | **Main uncertainty.** Each daily sync wakes the database. Estimate 30–150 |
| Functions compute | 10 credits per GB-hour | < 5 |
| Web requests | 2 credits per 10,000 | < 5 |
| Bandwidth | 20 credits per GB | < 5 |

Check the usage page in the Netlify dashboard after the first couple of weeks with real data, and adjust (e.g. sync less often) if database compute runs high.

## Build order

Each milestone ends with a working, deployed app.

1. **Foundation:** scaffold, database, auth gate, deploy an empty shell to Netlify.
2. **Ledger:** accounts and a starter chart, simple/split transaction entry, registers, natural-sign display, balances.
3. **Collection:** cards, sealed, games and hardware; product lookup; buy, baseline and sell flows.
4. **Pricing:** TCGCSV sync, then the PriceCharting scraper; dashboard with collection value, gain/loss and net worth.
5. **Recurring transactions:** templates, lazy generation as pending, due alerts.
6. **Wishlist:** target prices, alerts, conversion to owned items.
7. **Polish:** PWA install, reports and charts, bank import.
