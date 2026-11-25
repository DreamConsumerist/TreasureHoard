# Plan: Step 2 — Ledger

## Context

Step 1 left an authenticated, empty shell. Step 2 adds the double-entry ledger that everything else sits on:
- the Collection step books purchases into it as assets
- Pricing compares market value against it
- recurring transactions generate entries in it

The design is settled in [docs/plans/site-map.md](docs/plans/site-map.md) and [ARCHITECTURE.md](ARCHITECTURE.md):
- simple-first entry with an optional split
- natural-sign display
- a seeded starter chart of accounts
- fresh-start opening balances
- opening entries hidden by default

**Status:** approved 2026-11-24.

**Done when:**
- You can create, edit, archive and nest accounts, and each one starts at its current balance.
- You can add, edit and delete transactions, in simple or split form, from the desktop or from the mobile quick-add.
- The register and account registers show natural-sign amounts and running balances.
- The Dashboard shows book net worth, cash on hand, this month's spending against last month's, and recent transactions.
- An unbalanced transaction is impossible, rejected by both the API and the database.
- Tests pass against a real Postgres engine (PGlite). The first migration is confirmed to apply both locally and on a `dev` branch deploy.

**Not in this step:** reports, collection accounts (Step 3), recurring templates (Step 5), import tables (Step 7). Each one adds its own tables and columns later, through backward-compatible migrations.

---

## 1. Schema: `db/schema.ts`

```
account_type   enum: asset | liability | equity | income | expense
txn_status     enum: pending | cleared
txn_kind       enum: normal | opening

accounts
  id            integer identity PK
  name          text not null
  type          account_type not null
  parent_id     integer null → accounts.id (on delete restrict)
  system_key    text null unique          -- stable handle for accounts the app relies on
  archived      boolean not null default false
  created_at    timestamptz default now()
  unique (parent_id, name) NULLS NOT DISTINCT   -- no duplicate siblings, incl. at top level

transactions
  id            integer identity PK
  date          date not null              (Drizzle mode 'string': 'YYYY-MM-DD', no timezone drift)
  description   text not null
  notes         text null
  status        txn_status not null default 'cleared'
  kind          txn_kind not null default 'normal'
  external_id   text null unique           -- for bank import later; harmless now
  created_at, updated_at timestamptz
  index (date desc, id desc)

postings
  id             integer identity PK
  transaction_id integer not null → transactions.id (on delete cascade)
  account_id     integer not null → accounts.id (on delete restrict)
  amount_cents   bigint not null (mode 'number'), check (amount_cents <> 0)
  memo           text null
  index (account_id), index (transaction_id)
```

**Design notes:**
- **`system_key`:** the app needs to find certain accounts no matter what you rename them to. Step 2 seeds `opening_balances`, and Step 3 will add `collection_*` and `realized_gains`. You can rename these accounts, but you can't delete them.
- **Opening marker:** the `kind` column (`normal | opening`). This settles the question left open in the site map. A column is explicit and cheap to filter on. Inferring it from "posts to Opening Balances" would break if you ever booked a manual equity adjustment there.
- **`import_batch_id` and `recurring_template_id`** are not added yet. Adding nullable columns later is backward-compatible.
- **`amount_cents` as a JavaScript number** is exact up to about $90 trillion, and avoids handling `BigInt` throughout the app.

## 2. Migrations

1. `npm run db:generate` creates the tables. This is the first real migration.
2. **A custom migration** (`npx drizzle-kit generate --custom --name=ledger_integrity`, which gives an empty SQL file that I fill in by hand) holds what Drizzle's schema can't express:
   - **The balance backstop:** a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` on `postings`. At **commit time**, it checks that each affected transaction's postings sum to 0 and that there are at least 2 of them. A transaction that was deleted in the same commit is skipped. Because the check is deferred, the API can insert postings one row at a time inside a database transaction, and it only fails if the end state is unbalanced.
   - **Seed accounts:** the starter chart from the site map, but without the Collection accounts:
     - Assets: Checking, Savings
     - Liabilities: Credit Card
     - Equity: Opening Balances (`system_key = 'opening_balances'`)
     - Income: Salary, Other Income
     - Expenses: Groceries, Dining, Housing, Utilities, Transport, Subscriptions, Entertainment, Health, Shopping, Other

     The house payment goes to Expenses → Housing (decided 2026-11-24: no home asset or mortgage on the books). Modeling them later needs only new accounts, not a schema change.

     Seeding in a migration means it runs exactly once per database: in production on the first deploy, and locally after `db:migrate`. Branch deploys inherit it from production.

**First-migration check (left open in Step 1):** drizzle-kit 1.0 beta may write one folder per migration (`<timestamp>_name/migration.sql` plus a snapshot) rather than flat files. I'll inspect what it generates, confirm `npm run db:status` lists it as pending, then confirm it applies locally and on the `dev` branch deploy. If Netlify doesn't accept the layout, I'll stop and report back before working around it.

## 3. Shared ledger logic: `lib/ledger/` (pure functions, unit-tested)

The frontend imports these too. They only use web-standard APIs, so they type-check under both tsconfigs.

| File | Contents |
|---|---|
| `money.ts` | `parseMoney("1,234.5") → 123450`. String-based, never `parseFloat * 100`. It rejects more than 2 decimals and garbage input. `formatMoney(cents)` uses `Intl.NumberFormat('en-US', USD)`. |
| `sign.ts` | `isDebitNormal(type)` is true for asset and expense. `toNatural(cents, type)` flips the sign for liability, income and equity balances, for display. |
| `postings.ts` | `validatePostings(postings)`: at least 2 lines, none zero, sum = 0, all integers. `simpleToPostings({amount, fromId, toId})` → `[{toId, +amount}, {fromId, −amount}]`. `postingsToSimple(postings)` → the simple shape when there are exactly 2 lines of opposite sign, otherwise `null`; the form uses this to decide which mode to open in. |
| `tree.ts` | `buildAccountTree(flatAccounts)` builds the nested tree, with rolled-up balances and full paths like "Expenses: Groceries". |
| `schemas.ts` | **Zod** schemas for API request bodies (account create/update, transaction create/update, list query). The API uses them to validate requests, and the frontend uses them for form types. |

**Sign logic for the simple form:** "From Checking → To Groceries" debits Groceries and credits Checking. The same rule covers every case:
- income: From Salary → To Checking
- a credit card purchase: From Credit Card → To Dining
- a card payment: From Checking → To Credit Card

**New library: Zod (v4).** It's a schema library: you declare the shape a request body must have once, and it validates the body at runtime and gives you the matching TypeScript type. I chose it because the API currently hand-checks `typeof` (see `/login` in `api.mts`), and that doesn't scale to nested postings arrays. Hono has a first-party adapter for it (**`@hono/zod-validator`**, also new), which rejects bad bodies with a 400 before the handler runs.

## 4. API

**Restructure (called out explicitly):**
- `netlify/functions/api.mts` becomes a thin wrapper: `export default (req) => createApp(db).fetch(req)`.
- The Hono app moves into **`lib/api/app.ts`** as `createApp(db)`, with the auth routes unchanged and the ledger routes in `lib/api/ledger/*.ts`.
- **Why:** passing the database into `createApp` lets the tests run the real app against an in-memory Postgres (section 6). The auth and login behavior stays byte-for-byte the same.
- The parameter type is Drizzle's shared async Postgres database type, so both the Netlify driver and the PGlite driver fit. This is the riskiest typing point in the plan, and I'll verify it first.

| Method & path | Does |
|---|---|
| `GET /api/accounts` | All accounts, each with its `balance_cents` (all postings) and `cleared_balance_cents`. The client builds the tree. |
| `POST /api/accounts` | `{name, type, parentId?, openingBalanceCents?, openingDate?}`. A child must have the same type as its parent. An opening balance creates a `kind='opening'` transaction against Opening Balances, in the **same database transaction**. |
| `PATCH /api/accounts/:id` | Rename, move (the type must still match the parent), or archive and unarchive. The type can't change once the account has postings. |
| `DELETE /api/accounts/:id` | Only allowed with no postings, no children and no `system_key`. Otherwise it returns 409 and suggests archiving. |
| `GET /api/transactions` | Query parameters: `accountId`, `from`, `to`, `status`, `q` (description search), `includeOpening` (default false), `cursor`, `limit`. Results are newest first, using keyset pagination on (date, id). With `accountId`, each row also carries a `running_balance_cents`, computed with a SQL window function over that account's full history. Postings are included on every row. |
| `GET /api/transactions/:id` | One transaction with its postings. |
| `POST /api/transactions` | `{date, description, notes?, status, postings[]}`. It is validated with `validatePostings`, and archived accounts are rejected. The insert runs in one `db.transaction()`. |
| `PUT /api/transactions/:id` | Replaces the header and all postings in one database transaction. |
| `DELETE /api/transactions/:id` | Hard delete. Postings cascade. |
| `GET /api/transactions/suggest?q=` | Recent distinct descriptions, each with its last-used accounts and amount. Typing "Kroger" pre-fills From/To. |
| `GET /api/dashboard` | Book net worth (assets − liabilities), cash on hand (asset accounts excluding Collection; for now that's all assets), this month's and last month's expense totals with the top categories, and the last 8 transactions. |
| `GET /api/health` | Unchanged. It moves to the Settings page. |

**Errors:** validation failures return 400 with field details, conflicts return 409, and a not-found returns 404, all in the `{error}` shape that `src/lib/api.ts` already reads.

**Driver check:** I confirmed in `node_modules/drizzle-orm/netlify-db/session.js` that `db.transaction()` works on Netlify. It takes a WebSocket `Pool` connection, while single queries go over HTTP. Locally, `netlify dev` uses node-postgres against PGlite.

## 5. Frontend

**Routing (`src/main.tsx`):** a layout route renders an **`AppShell`**: a sidebar on desktop, and a bottom tab bar (Dashboard · Ledger · Add) on mobile. The Collection tab appears in Step 3. The shell wraps:

```
/                       Dashboard          (replaces Home.tsx)
/ledger                 Register
/ledger/new             TransactionPage (create)
/ledger/:id             TransactionPage (edit)
/ledger/accounts        AccountsPage (tree, create/edit/archive dialogs)
/ledger/accounts/:id    AccountRegister (running balance)
/settings               DB health + log out (moved from Home)
/login                  unchanged, outside the shell
```

The Ledger pages share sub-tabs: Register · Accounts. Recurring and Reports appear in their own steps.

**Components (`src/components/`):**
- `TransactionForm`: the core component.
  - **Simple mode:** Amount · Description (with suggestions) · From · To · Date (today, local time) · Status · Notes.
  - The **Split** toggle switches to a postings grid with a live "remaining: $x.xx" counter. Save is disabled until it balances.
  - On edit, the form opens in simple mode if `postingsToSimple` succeeds, otherwise in split mode.
- `AccountPicker`: a searchable select grouped by type, showing full paths, with archived accounts hidden.
- `MoneyInput`: a text input with `inputMode="decimal"` (the phone shows a numeric keypad), parsed through `parseMoney`.
- `Amount`: formatted output with natural sign and color.
- `QuickAddSheet`: `TransactionForm` inside a native `<dialog>`, opened by the Add tab and by the "New transaction" buttons.
- `AccountTree`: collapsible rows with rolled-up balances.
- On narrow screens, tables render as card lists, using Tailwind breakpoints.

**Data (`src/lib/queries.ts`):**
- TanStack Query hooks for each endpoint, under the keys `['accounts']`, `['transactions', filters]`, `['transaction', id]`, `['dashboard']`.
- Every mutation invalidates `accounts`, `transactions` and `dashboard`.
- The register uses `useInfiniteQuery` with the API cursor.

## 6. Tests

**New dev dependency: `@electric-sql/pglite`.** It's Postgres compiled to WebAssembly, running in-process with no server. `netlify dev` already uses it for your local database (it's a dependency of `@netlify/database-dev`), so the tests run on the same engine you develop against. Drizzle has a matching driver, `drizzle-orm/pglite`.

| File | Covers |
|---|---|
| `tests/ledger/money.test.ts` | Parsing edge cases (`"0.1"`, `"1,000"`, `"-5"`, `"1.234"` rejected, `""` rejected) and formatting |
| `tests/ledger/postings.test.ts` | Validation rules, and simple ↔ postings round-trips |
| `tests/ledger/sign.test.ts`, `tree.test.ts` | Natural signs per type, tree rollups and paths |
| `tests/api/ledger.test.ts` | A fresh PGlite instance per file → apply the real migrations from `netlify/database/migrations/` → `createApp(testDb).request(...)`, with a valid session cookie built by the existing `createSessionToken`. |

The API integration tests cover:
- account CRUD, including the parent/type rule and the delete-vs-archive rules
- an opening balance creating a hidden `opening` transaction
- a balanced POST succeeds; an unbalanced POST returns 400
- **a raw unbalanced insert that bypasses the API is rejected by the trigger** (this proves the backstop works)
- PUT replaces postings; DELETE cascades
- the running balance is correct across pages
- `includeOpening` filtering
- the dashboard totals

## 7. Files

**New:**
- `lib/ledger/{money,sign,postings,tree,schemas}.ts`
- `lib/api/app.ts`
- `lib/api/ledger/{accounts,transactions,dashboard}.ts`
- `netlify/database/migrations/*` (generated plus the custom one)
- `src/components/*` (above)
- `src/routes/{Dashboard,Register,TransactionPage,AccountsPage,AccountRegister,Settings}.tsx`
- `src/lib/queries.ts`
- `tests/ledger/*`, `tests/api/ledger.test.ts`
- `docs/plans/02-ledger.md`

**Modified:**
- `db/schema.ts` (tables)
- `netlify/functions/api.mts` (becomes a thin wrapper)
- `src/main.tsx` (routes and shell)
- `package.json` (`zod`, `@hono/zod-validator`, dev `@electric-sql/pglite`)
- `ARCHITECTURE.md` (adds `system_key` and `kind` to the data model)

**Removed:** `src/routes/Home.tsx`. Its content splits between Dashboard and Settings.

## 8. Implementation order

1. Schema, the generated migration, the custom trigger and seed migration, `db:migrate` locally, and the migration-layout check.
2. `lib/ledger/*` plus unit tests.
3. `createApp(db)` refactor, then the PGlite harness, then the API routes plus integration tests.
4. Frontend: shell and routing, then accounts, then the transaction form and quick-add, then the registers, then the dashboard.
5. Push to `dev` (with your go-ahead) and verify the branch deploy and its migration.

## 9. Verification

- `npm test`: unit and PGlite integration tests, including the trigger backstop test.
- `npm run build` (type-checks all three tsconfigs) and `npm run lint`.
- `npm run db:status` before and after `npm run db:migrate`, to see the migrations go from pending to applied.
- **Manual, at http://localhost:8888 via `npm run dev`:**
  1. Give Checking an opening balance.
  2. Add a simple grocery purchase.
  3. Add a split transaction (paycheck → Checking + Savings).
  4. Pay the credit card.

  Then check the natural signs in the account registers, the running balances, the opening entry hidden and then shown by the toggle, and the dashboard figures. Repeat quick-add at phone width in DevTools.
- After you approve a push to `dev`: the branch deploy log shows the migration applied, and the deployed site behaves the same against its branch database.
