# Plan: Site map and feature set

**Status:** approved 2026-11-24. ARCHITECTURE.md updated to match.

**Goal:** settle how the app is organized (pages, navigation, the main flows) and which features are in scope, before Step 2 (Ledger) starts. This plan covers structure and behavior. Each feature still gets its own step plan with schema and API details before it's built.

**Decisions already made (2026-11-24):**
- Card and game purchases are **assets at cost**, not expenses. Tracking what the collection is really worth is the reason for the app.
- Collection scope: **MTG, One Piece and Riftbound** (including sealed Riftbound boxes), **video games, consoles and accessories**. No graded cards.
- Bulk and lot purchases are out of scope. If one happens, cost basis is split by hand.
- New features in scope: **recurring transactions** and a **wishlist with price alerts**.
- **Fresh-start baseline:** there are no purchase records for the existing collection, so items already owned are entered at their **market value on the day they're added**. Gains are tracked from that point forward. The same applies to cash accounts: they start at today's balance. See section 5, "Baseline items".

---

## 1. Site map

```
/                          Dashboard
/ledger                    Register: every transaction, filterable
/ledger/new                Transaction editor (also opens as a sheet from "Add")
/ledger/:id                View / edit one transaction
/ledger/accounts           Chart of accounts: tree with rolled-up balances
/ledger/accounts/:id       One account's register with a running balance
/ledger/recurring          Recurring templates and what's due
/ledger/reports            Spending by category, balance sheet, net worth over time
/collection                Owned items: filter by kind/game/set/platform, sort by value or gain
/collection/new            Add an item, with a product lookup
/collection/:id            Item detail: price chart, cost basis, gain, linked transactions, sell
/collection/wishlist       Wanted items with target prices
/settings                  Price sync health, manual price overrides, log out; later import and rules
/login
```

Ledger and Collection each group their sub-pages under one URL prefix, so the top level stays at four destinations.

## 2. Navigation

| | Desktop | Mobile |
|---|---|---|
| Primary | Left sidebar: Dashboard, Ledger, Collection, Settings | Bottom tab bar: Dashboard, Ledger, Collection, **Add** |
| Secondary | Sub-tabs at the top of Ledger (Register · Accounts · Recurring · Reports) and Collection (Owned · Wishlist) | Same sub-tabs as a scrollable segmented control |
| Settings | Sidebar item | Gear icon in the Dashboard header |
| Add | "New transaction" button on Ledger, "Add item" on Collection | The Add tab opens the quick-add sheet from anywhere |

On narrow screens, tables become card lists (as already planned in ARCHITECTURE.md).

## 3. Dashboard

One screen that answers "how am I doing":

- **Net worth, two ways:**
  - **Market net worth** (headline) = book net worth − collection cost + collection market value.
  - **Book net worth** = assets − liabilities from the ledger, with the collection at cost.
  - The difference is the collection's **unrealized gain**, shown as its own line.
- **Cash on hand:** the sum of checking and savings-type accounts.
- **This month's spending** against last month's, by top categories.
- **Collection:** total market value, unrealized gain, biggest movers since the last sync.
- **Recent transactions:** the last 5–10.
- **Alerts strip:**
  - recurring transactions due
  - wishlist items at or under their target price
  - stale prices ("game prices last synced Nov 12")
  - later: imported transactions awaiting review

## 4. Ledger

### Transaction entry: simple first, split when needed
- The default form is **Amount · Payee/description · From · To · Date (today) · Status**. It creates a two-posting transaction. Most personal transactions are exactly this.
- A **Split** button expands it into a full postings grid (account, amount, memo per line) with a live "remaining to balance" counter. Saving is blocked until it balances.
- Debit/credit language stays hidden unless split mode is open.
- The quick-add sheet is this same form, not a separate one, with a numeric keypad for the amount on mobile.

### Display signs
The database stores debits as positive. The UI shows each account's balance in its **natural sign**:
- Liability, income and equity balances are flipped, so a credit card shows "$420 owed", not "−$420".
- Expense accounts show spending as positive.

### Accounts
- A tree with rolled-up balances. Archive instead of delete once an account has postings.
- **Seeded starter chart** on first run, editable afterwards:
  - Assets: Checking, Savings, **Collection** → Cards, Sealed, Games, Hardware
  - Liabilities: Credit Card
  - Equity: Opening Balances
  - Income: Salary, **Realized Gains on Collection**
  - Expenses: a short default list (Groceries, Dining, Housing, Transport, Subscriptions, …)

### Reports
- **Spending by category** over a chosen period.
- **Cash-flow view** with **collection purchases as their own line**. Purchases no longer appear as expenses, so this keeps hobby spending visible.
- **Balance sheet**, and **net worth over time**, both book and market (the market line uses price snapshots).

## 5. Collection

### Item kinds
| Kind | Priced from | Lookup |
|---|---|---|
| `card` (MTG, One Piece, Riftbound) | TCGCSV, by product ID + sub-type (Normal/Foil) | Pick game → set → search the set's products |
| `sealed` (e.g. Riftbound booster boxes) | TCGCSV (TCGplayer lists sealed products as products) | Same as cards |
| `game` | PriceCharting: loose / CIB / new | Paste the PriceCharting URL |
| `hardware` (consoles, accessories) | PriceCharting, same as games | Paste the URL; manual price if the edition isn't listed |

TCGCSV category IDs (checked 2026-11-24): MTG = 1, One Piece = 68, Riftbound = 89.

**Product lookup:**
- Cards and sealed: the API fetches TCGCSV's product list for the chosen set on demand, and the browser filters it as you type. No local copy of the whole catalog.
- Games and hardware: pasting a URL triggers **one** fetch of that page to confirm the title and current prices. This is the same single-page fetch the weekly scraper does, so it stays within the polite-scraping rules.

### Asset-at-cost accounting
| Event | Ledger entry |
|---|---|
| Buy | Debit **Collection → (kind)**, credit the paying account (Checking, Credit Card). The item's `cost_basis_cents` = the amount, `acquired_txn_id` = the transaction. |
| Already owned (baseline) | Adding an item marked **"already owned"** creates an **opening-balance** transaction dated the day it's added: debit Collection, credit Equity → Opening Balances, at the item's current market value. See "Baseline items" below. |
| Sell | Proceeds to the receiving account, credit Collection for the cost basis, and the difference to **Realized Gains on Collection** (a loss is a debit to the same account). `sold_txn_id` = the transaction. |
| Sell part of a quantity | The item row splits: selling 1 of 3 leaves a row of 2 and creates a sold row of 1, with cost basis prorated. |

**Invariant:** the Collection account's balance equals the summed cost basis of unsold items. Settings shows a check for this and flags any mismatch.

### Baseline items (fresh-start basis)
- **Cost basis = market value on the day the item is entered.** The product lookup already fetches current prices: for TCGCSV, the set's price file is fetched alongside its product list; for PriceCharting, the one-page confirmation fetch. The lookup **pre-fills** the basis from that price, and you can edit it. If no price is found (an unlisted console edition, for example), you type in a value.
- Because the value comes from the lookup, **this doesn't depend on Step 4 (Pricing)**. Baseline entry works as soon as Step 3 ships.
- **The baseline date is per item, not one global date.** Cataloguing an existing collection takes days or weeks. Each item's opening entry is dated the day you add it, at that day's price, so the basis always matches a real price on a real date. Book net worth grows as you catalogue. That's expected, and it settles once everything is in.
- Items record **how their basis was set**: `basis_source` = `purchase` or `baseline`. Baseline items show "gain since added" instead of "gain", and reports can separate the two.
- **The register hides opening-balance transactions by default**, behind a filter toggle, so cataloguing a few hundred cards doesn't bury real activity.
- For baseline items, realized gains are measured from the baseline value, not from the original price paid. That's intended: the app is for personal tracking, not taxes.

### Item detail page
Price history chart, cost basis, current value, unrealized gain (amount and %), linked purchase and sale transactions, the price source (with a manual override), notes, and a **Sell** button.

## 6. Wishlist and price alerts

- A wishlist entry uses the same product reference as an item (source + external ID + variant), plus a **target price** and notes. It is looked up with the same flow as Add item.
- The daily and weekly price syncs **also fetch prices for wishlist products**. This is a small addition to their scope.
- **Alert:** when the latest price is at or under the target, the entry is highlighted and it appears in the Dashboard alerts strip.
- **Got it:** converts a wishlist entry into an owned item and opens the purchase form with the product filled in.
- **Delivery is in-app only for now.** Push notifications (via the PWA) or email (needs a mail provider) can be added later. Both need extra setup, so they're deferred.

## 7. Recurring transactions

- A **template** holds a transaction (description and postings, in simple or split form) plus a schedule: every N weeks/months/years, a start date, and an optional end date.
- **Due items are generated as `pending` transactions** for you to confirm or edit, never silently posted as cleared. Amounts vary (utilities), so confirmation matters.
- **Generation is lazy:** the API creates any due-but-missing transactions when the app loads data, instead of on a scheduled job. This is simpler, easy to test, and doesn't wake the database on days you don't open the app (see the credit budget in ARCHITECTURE.md).
- `/ledger/recurring` lists templates with their next due dates. A transaction created from a template links back to it.

## 8. Settings

- **Price sync health:** last run, status and failures per job, from `sync_runs`.
- **Manual price overrides** list.
- **Collection invariant check** (see section 5).
- Log out.
- Later: bank import and categorization rules.

## 9. Revised build order

| Step | Contents |
|---|---|
| 1. Foundation | *(code done; deploy pending)* |
| 2. Ledger | Accounts and starter chart, simple/split entry, register and account registers, natural-sign display, balances |
| 3. Collection | All four item kinds, product lookup, buy / opening-balance / sell flows, invariant check |
| 4. Pricing | TCGCSV sync, PriceCharting scraper, item price charts, Dashboard collection and net-worth figures |
| 5. Recurring transactions | Templates, lazy generation, due alerts |
| 6. Wishlist | Entries, sync scope extension, alerts, "Got it" conversion |
| 7. Polish | PWA install, reports and charts, bank import |

Recurring transactions only depend on the ledger, so they could move up to right after Step 2 if you'd rather have them sooner. The wishlist needs pricing, so it has to come after Step 4.

## 10. Schema implications (for later step plans, not built now)

- `items.kind`: `card | sealed | game | hardware` (was `card | game`).
- `items.basis_source`: `purchase | baseline`.
- `transactions` needs a way to mark opening-balance entries so the register can hide them: either a `kind` column (`normal | opening`) or a check for "posts to Equity → Opening Balances". Decided in the Step 2 plan.
- `card_details` covers sealed products too. `sub_type` is nullable, because sealed products have none. It may be renamed `tcg_details`.
- `game_details` covers hardware. `platform` holds the console family.
- New: `wishlist_items`, `recurring_templates` (+ template postings), and a `recurring_template_id` on `transactions`.
- Price syncs select products from owned items **and** wishlist entries.

## 11. ARCHITECTURE.md updates on approval

- The build order (section 9).
- The data model additions (section 10).
- The asset-at-cost accounting and opening-balance rule. These replace the line "Market value lives in snapshots, not in the ledger…" with the clearer split: **cost is in the ledger, market value is in snapshots**.
- The mobile tab bar stays as is. The routes comment in the project layout is updated.

## Out of scope (for now)
Bulk and lot purchases with automatic cost allocation, graded cards, trades, budgets, push or email alerts.
