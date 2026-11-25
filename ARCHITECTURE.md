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
Background Functions ────────────────┘
   ├─ sync-tcg-prices    (TCGCSV)
   └─ sync-game-prices   (PriceCharting scraper)
        ▲
Scheduled Functions (cron triggers only)
   ├─ daily  → sync-tcg-prices
   └─ weekly → sync-game-prices
```

Scheduled functions only fire on the published production deploy, not on deploy previews. On a preview they can be run by hand with the **Run now** button in the Netlify UI. Locally, `netlify functions:invoke <name>` runs one once.

## Data model

### Ledger (double-entry)

- **`accounts`**: `id`, `name`, `type` (`asset` | `liability` | `equity` | `income` | `expense`), `parent_id` (for nesting, e.g. Expenses → Hobbies → Cards; same type as the parent), `system_key` (unique, nullable: a stable handle for accounts the app relies on, such as `opening_balances`; these can be renamed but not deleted), `archived`. Sibling names are unique.
- **`transactions`**: `id`, `date`, `description`, `notes`, `status` (`pending` | `cleared`), `external_id` (unique, nullable; set by imports), `import_batch_id` (nullable), `kind` (`normal` | `opening`; opening-balance entries are hidden from the register by default), `recurring_template_id` (nullable, Step 5).
- **`recurring_templates`** *(Step 5)*: description, template postings, schedule (every N weeks/months/years, start, optional end). Due occurrences are generated lazily, as `pending` transactions, when the API loads data.
- **`postings`**: `id`, `transaction_id`, `account_id`, `amount_cents` (signed bigint), `memo`.
- **`import_batches`**: `id`, `source`, `filename`, `imported_at`.
- **`categorization_rules`** *(later)*: description pattern → account.

Rules:
- **Money is stored as integer cents.** Never as floats.
- **Each transaction's postings sum to zero, and there are at least two.** The API enforces this (Zod schema + `lib/ledger/postings.ts`). As a backstop, deferred constraint triggers check it at commit time (hand-written migration `ledger_integrity`), so even code that bypasses the API can't save an unbalanced transaction.
- Sign convention: positive = debit, negative = credit.
- Account balances and net worth are derived from postings, never stored.

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
- **`sync_runs`**: `job`, `started_at`, `finished_at`, `status`, `ok_count`, `failed_count`, `error`. Powers the "prices stale since X" indicator.

### Collection accounting

**Cost is in the ledger, and market value is in snapshots.** Price changes therefore never clutter the books.

- **Purchases are assets at cost:** debit Assets → Collection → (Cards | Sealed | Games | Hardware), credit the paying account.
- **Sales:** proceeds to the receiving account, credit Collection for the cost basis, and the difference to Income → Realized Gains on Collection. Selling part of a quantity splits the item row and prorates the basis.
- **Fresh-start baseline:** there are no purchase records for the existing collection, so items already owned are entered at their market value on the day they're added (`basis_source = baseline`). This happens through an opening-balance transaction (debit Collection, credit Equity → Opening Balances). Cash accounts likewise start at their current balances. Gains on baseline items are measured from that value. The app is for personal tracking, not taxes.
- **Invariant:** the Collection account balance equals the summed cost basis of unsold items. It's kept by construction: every collection write updates the item and its transaction together; transactions linked to items can't be edited or deleted from the ledger (409); ordinary transactions can't post to Collection accounts; and the Collection accounts can't be archived, moved, nested under, or given a starting balance. `GET /api/collection/check` (shown in Settings) verifies it.
- **Net worth comes in two forms:**
  - **book**: from the ledger, with the collection at cost
  - **market**: book − collection cost + collection market value

  The Dashboard headlines market net worth.

## Pricing integrations

### TCGCSV (cards)
- Runs daily: a scheduled function triggers a background function that does the work.
- Downloads price files only for groups (sets) that contain owned cards or wishlist entries.
- Matches by TCGplayer product ID and sub-type.

### PriceCharting (games): scraper
Scraping is against PriceCharting's terms; for this personal, low-volume use that risk is accepted. The scraper is built to stay polite and to fail visibly:

- **Narrow scope:** fetches only the stored `pricecharting_url` of owned items and wishlist entries, plus a single page fetch when a URL is pasted in to add an item. No crawling, no search scraping.
- **Low rate:** weekly runs, requests spaced a few seconds apart with jitter, honors `robots.txt`.
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
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`.
- `.env*`, `.netlify/`, and raw bank exports are git-ignored.

## Mobile UX

- On narrow screens, tables become card lists. Bottom tab bar: Dashboard, Ledger, Collection, Add. The full site map is in [docs/plans/site-map.md](docs/plans/site-map.md).
- **Quick-add:** amount (numeric keypad), payee, category, and date (defaults to today). An optional "this is a card or game" toggle also creates the inventory item, linked to the transaction.
- Installable as a PWA.

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
│  │  ├─ sync-tcg-prices.mts     # background function
│  │  ├─ sync-game-prices.mts    # background function
│  │  └─ schedules.mts           # scheduled triggers (daily / weekly)
│  ├─ edge-functions/auth.ts     # password gate
│  └─ database/migrations/       # SQL generated by drizzle-kit; applied by Netlify on deploy
├─ db/
│  ├─ schema.ts                  # Drizzle table definitions (source of truth)
│  └─ index.ts                   # Drizzle client
├─ lib/                          # pure logic, no Netlify dependencies
│  ├─ api/                       # Hono app: createApp(db, { fetch }) + ledger/ and collection/ route modules
│  ├─ collection/                # posting builders, price keys, Zod schemas, response types
│  ├─ ledger/                    # money, signs, posting rules, account tree, Zod schemas, shared types
│  ├─ pricing/tcgcsv.ts
│  ├─ pricing/pricecharting.ts   # fetch + parse
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
