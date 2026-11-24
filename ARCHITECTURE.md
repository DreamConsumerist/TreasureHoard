# Architecture

Personal finance app for a single user. It has two jobs:

1. **General ledger:** double-entry bookkeeping for personal spending.
2. **Collection valuation:** an inventory of trading cards and video games, with market prices tracked over time.

The app will not be distributed, so there's no multi-tenancy or onboarding. It is still deployed at a public URL and holds financial data, so it sits behind authentication.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript throughout | Frontend, functions and schema share types |
| Frontend | React + Vite SPA | TanStack Query (data), Tailwind CSS (styling), Recharts (charts) |
| Mobile | Responsive layout + PWA (`vite-plugin-pwa`) | Installable to the phone home screen |
| API | Netlify Functions | One REST router at `/api/*` |
| Jobs | Netlify Scheduled Functions | Price syncs |
| Auth | Netlify Edge Function | Single hashed password in an env var; signed session cookie |
| Database | Postgres via Netlify DB (Neon) | Drizzle ORM for schema, queries and migrations |
| Card prices | TCGCSV (tcgcsv.com) | Daily dump of TCGplayer prices; TCGplayer's own API is closed to new developers |
| Game prices | PriceCharting, scraped | Parsed with `cheerio`. Their API costs $50/month, too much for personal use |

## System overview

```
Browser / phone (React SPA, PWA)
   │  fetch /api/*
   ▼
Edge Function: auth gate ── rejects requests without a valid session
   ▼
Netlify Functions (api) ───────► Postgres (Neon)
                                     ▲
Scheduled Functions ─────────────────┘
   ├─ sync-tcg-prices    daily   (TCGCSV)
   └─ sync-game-prices   weekly  (PriceCharting scraper)
```

## Data model

### Ledger (double-entry)

- **`accounts`**: `id`, `name`, `type` (`asset` | `liability` | `equity` | `income` | `expense`), `parent_id` (for nesting, e.g. Expenses → Hobbies → Cards), `archived`.
- **`transactions`**: `id`, `date`, `description`, `notes`, `status` (`pending` | `cleared`), `external_id` (unique, nullable; set by imports), `import_batch_id` (nullable).
- **`postings`**: `id`, `transaction_id`, `account_id`, `amount_cents` (signed bigint), `memo`.
- **`import_batches`**: `id`, `source`, `filename`, `imported_at`.
- **`categorization_rules`** *(later)*: description pattern → account.

Rules:
- **Money is stored as integer cents.** Never as floats.
- **Each transaction's postings sum to zero.** The API enforces this, with a database-level check as a backstop.
- Sign convention: positive = debit, negative = credit.
- Account balances and net worth are derived from postings, never stored.

### Inventory

- **`items`**: `id`, `kind` (`card` | `game`), `name`, `quantity`, `condition`, `cost_basis_cents`, `acquired_date`, `acquired_txn_id` (nullable → transactions), `sold_txn_id` (nullable → transactions), `notes`.
- **`card_details`**: `item_id`, `tcgplayer_product_id`, `sub_type` (e.g. Normal, Foil), `set_name`.
- **`game_details`**: `item_id`, `platform`, `pricecharting_url`, `variant` (`loose` | `cib` | `new`).

### Valuation

- **`price_snapshots`**: `source` (`tcgcsv` | `pricecharting` | `manual`), `external_id`, `variant`, `price_cents`, `as_of`.
  - Unique on (`source`, `external_id`, `variant`, `as_of`).
  - Keyed by **product**, not item, so multiple copies of the same product share one price history.
  - Append-only. Supports value-over-time charts and unrealized gain/loss against cost basis.
- **`sync_runs`**: `job`, `started_at`, `finished_at`, `status`, `ok_count`, `failed_count`, `error`. Powers the "prices stale since X" indicator.

Market value lives in snapshots, **not** in the ledger, so price changes don't clutter the books. Mark-to-market ledger entries can be added later if collection value should count toward net worth on the books.

## Pricing integrations

### TCGCSV (cards)
- Daily scheduled job.
- Downloads price files only for groups (sets) that contain owned cards.
- Matches by TCGplayer product ID and sub-type.

### PriceCharting (games): scraper
Scraping is against PriceCharting's terms; for this personal, low-volume use that risk is accepted. The scraper is built to stay polite and to fail visibly:

- **Narrow scope:** fetches only the stored `pricecharting_url` of owned items. No crawling, no search scraping.
- **Low rate:** weekly runs, requests spaced a few seconds apart with jitter, honors `robots.txt`.
- **Isolated parsing:** `parsePriceChartingPage(html) → { loose, cib, new }` lives in a single module, so markup changes need a fix in one file only.
- **Visible failure:** a parse failure is logged to `sync_runs` and the last good snapshot is kept. It is never recorded as a zero price.
- **Fixture test:** saved HTML in `tests/fixtures/` catches layout changes.
- **Portable runner:** scraper logic in `lib/` has no Netlify dependencies. If Netlify's (AWS) IPs get blocked, the same code runs from a scheduled GitHub Action or locally (`scripts/scrape-local.ts`).
- **Manual override:** any item's price can be entered by hand (`source = manual`).

## Bank import (planned)

Manual entry is the primary input. Import is added later, once the export format from Global Credit Union is known. Prefer OFX/QFX (stable `FITID`) over CSV.

- Parser interface: `parse(file) → RawTransaction[]`, one implementation per format.
- **Deduplication:** `transactions.external_id` holds the FITID, or for CSV a hash of date + amount + description. A unique constraint makes re-imports harmless.
- **Rollback:** every imported transaction references an `import_batches` row.
- **Review flow:** imported rows land as `pending` with the bank-account side filled in. The user assigns the other side (expense account), optionally helped by categorization rules.
- Real bank exports are git-ignored. Only sanitized samples go in `tests/fixtures/`.

## Security

- Edge Function gate on every route (pages and API) except the login endpoint.
- Password hash and session-signing secret live in Netlify environment variables, never in the repo.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`.
- `.env*`, `.netlify/`, and raw bank exports are git-ignored.

## Mobile UX

- On narrow screens, tables become card lists. Bottom tab bar: Dashboard, Ledger, Inventory, Add.
- **Quick-add:** amount (numeric keypad), payee, category, and date (defaults to today). An optional "this is a card or game" toggle also creates the inventory item, linked to the transaction.
- Installable as a PWA.

## Project layout

```
Personal Finance App/
├─ netlify.toml
├─ src/                          # React app
│  ├─ routes/                    # dashboard, ledger, accounts, inventory, import
│  └─ components/
├─ netlify/
│  ├─ functions/
│  │  ├─ api.mts                 # REST router
│  │  ├─ sync-tcg-prices.mts     # scheduled, daily
│  │  └─ sync-game-prices.mts    # scheduled, weekly
│  └─ edge-functions/auth.ts     # password gate
├─ db/
│  ├─ schema.ts
│  └─ migrations/
├─ lib/                          # pure logic, no Netlify dependencies
│  ├─ ledger/                    # balance checks, money helpers
│  ├─ pricing/tcgcsv.ts
│  ├─ pricing/pricecharting.ts   # fetch + parse
│  └─ import/                    # OFX / CSV parsers (later)
├─ scripts/scrape-local.ts       # fallback scraper runner
└─ tests/fixtures/               # saved HTML, sanitized bank samples
```

## Build order

Each milestone ends with a working, deployed app.

1. **Foundation:** scaffold, database, auth gate, deploy an empty shell to Netlify.
2. **Ledger:** accounts, manual transactions, balances.
3. **Inventory:** items with card/game details, linked to purchase transactions.
4. **Pricing:** TCGCSV sync, then the PriceCharting scraper; dashboard with collection value and gain/loss.
5. **Polish:** PWA install, charts, bank import.
