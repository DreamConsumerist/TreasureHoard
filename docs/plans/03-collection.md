# Plan: Step 3 — Collection

## Context

The ledger (Step 2) is live in production. Step 3 adds the reason the app exists: an inventory of cards, sealed product, games and hardware, booked into the ledger as **assets at cost**. The design is settled in [docs/plans/site-map.md](docs/plans/site-map.md) and [ARCHITECTURE.md](ARCHITECTURE.md):
- four item kinds
- product lookup
- buy, baseline ("already owned") and sell flows
- a fresh-start basis for existing items: market value on the day they're added
- the Collection invariant

**Status:** approved 2026-11-24.

**Findings from the live sources (checked 2026-11-24):**
- **TCGCSV:**
  - Groups (sets) come from `/tcgplayer/{cat}/groups`. There are 459 MTG sets, 90 One Piece and 15 Riftbound, and the lists include unreleased future sets.
  - Products and prices come per set from `/{cat}/{group}/products` and `/prices`.
  - A large MTG set is about 870 KB of products plus 185 KB of prices.
  - Prices are **dollar floats** (`marketPrice: 256.03`), one row per product and sub-type (`Normal`/`Foil`). They can be `null`.
  - Sealed products have no `Rarity`/`Number` in `extendedData`.
  - **No CORS headers**, so the browser can't call it directly; requests go through our API.
  - A third rapid request came back empty, which suggests rate limiting, so requests go one at a time with a retry.
- **PriceCharting:**
  - robots.txt only disallows checkout paths.
  - `td#used_price` / `#complete_price` / `#new_price` (loose / CIB / new) each contain `<span class="price js-price">$19.89</span>`, followed by a change span that must be ignored.
  - The title is in `h1#product_name`.
  - Hardware page layout is **not yet confirmed**; to be checked during implementation (ideally with your 3DS's URL).

**Done when:**
- You can add any of the four kinds by lookup (or by hand when there's no listing), as **bought** (a purchase transaction) or **already owned** (an opening entry at today's market value).
- You can sell an item, fully or part of its quantity. The gain or loss is booked to Realized Gains on Collection.
- The collection page shows cost basis, latest known value and unrealized gain. Values come from the price seen at lookup; scheduled syncs come in Step 4.
- The ledger can't be edited out from under the collection. Settings shows the invariant check passing.
- Tests pass, and the migration applies on deploy.

**Not in this step:** scheduled price syncs, price charts and market net worth (Step 4); wishlist (Step 6); several items from one purchase transaction (out of scope, like lots).

---

## 1. Schema: `db/schema.ts` (new tables, plus one new migration)

```
item_kind      enum: card | sealed | game | hardware
basis_source   enum: purchase | baseline
game_variant   enum: loose | cib | new
price_source   enum: tcgcsv | pricecharting | manual

items
  id, kind, name, quantity int (check > 0), condition text null, notes text null
  cost_basis_cents bigint            -- total for the row's quantity, not per unit
  basis_source                       -- purchase | baseline
  acquired_date date
  acquired_txn_id  → transactions (on delete restrict)   not null
  sold_txn_id      → transactions (on delete restrict)   null
  sale_proceeds_cents bigint null    -- for realized-gain display without re-reading postings
  created_at

card_details   (card + sealed)   item_id PK → items (cascade)
  category_id int, group_id int, tcgplayer_product_id int, sub_type text null,
  set_name text, number text null, rarity text null, image_url text null

game_details   (game + hardware) item_id PK → items (cascade)
  platform text, pricecharting_url text null (null = manually priced), variant game_variant

price_snapshots
  id, source price_source, external_id text, variant text not null default '',
  price_cents bigint, as_of date, unique (source, external_id, variant, as_of)
```

- **`price_snapshots` arrives now, not in Step 4.** The price seen at lookup is recorded as the first snapshot, which gives baseline values a traceable source. Step 4's sync then adds to the same table.
- Snapshot keys:
  - TCGCSV: `external_id` = product ID, `variant` = sub-type.
  - PriceCharting: `external_id` = the URL path, `variant` = loose/cib/new.
  - Manual: `external_id` = `item:<id>`.
- **`group_id` and `category_id`** are stored so Step 4 can fetch price files only for sets you own.
- **`on delete restrict`** on both transaction links is the database-level guard: a linked transaction can't be deleted out from under an item.

**Seed (in the same custom migration):**
- Assets → **Collection** (`collection`), with children **Cards** / **Sealed** / **Games** / **Hardware** (`collection_card` … `collection_hardware`).
- Income → **Realized Gains on Collection** (`realized_gains`).
- Production is live and you may already have created accounts, so the seed runs in a plpgsql `DO` block. If a same-named account of the same type already exists, it **adopts** it by setting its `system_key`; otherwise it inserts a new one. This way a name collision can't fail the deploy.

## 2. Accounting: `lib/collection/accounting.ts` (pure functions, unit-tested)

| Function | Postings |
|---|---|
| `purchasePostings(kindAccount, fromAccount, cost)` | Collection:kind **+cost**, paying account **−cost** |
| `baselinePostings(kindAccount, openingAccount, value)` | Collection:kind **+value**, Opening Balances **−value** (`kind='opening'`) |
| `salePostings({ toAccount, kindAccount, gainsAccount, basis, proceeds })` | receiving **+proceeds**, Collection:kind **−basis**, Gains **−(proceeds − basis)**; zero lines are left out (break-even, free giveaway, $0 basis) |
| `splitBasis(basis, qty, sellQty)` | Prorated basis for a partial sale. The remainder stays on the original row so the parts always sum exactly. |

Every result passes through the existing `validatePostings` (`lib/ledger/postings.ts`).

## 3. Pricing clients: `lib/pricing/`

- **`tcgcsv.ts`:**
  - `GAMES = { mtg: 1, onepiece: 68, riftbound: 89 }`.
  - `fetchGroups(cat)` drops sets that aren't published yet.
  - `fetchSetCatalog(cat, group)` fetches products and then prices **sequentially** (one retry on an empty or failed response). It returns trimmed rows `{productId, name, number, rarity, imageUrl, sealed, prices: [{subType, marketCents, lowCents}]}`, about 10% of the raw size.
  - Dollar floats become cents through `parseMoney(x.toFixed(2))`, reusing `lib/ledger/money.ts` and never `x * 100`.
  - `fetch` is passed in, so tests can supply a fake.
- **`pricecharting.ts`:**
  - `parsePriceChartingPage(html) → { name, prices: { loose, cib, new } }`. Each price comes from the **first** `span.js-price` inside its `td`, and `-`/`N/A` becomes `null`.
  - `fetchPriceChartingPage(url)` accepts only `https://www.pricecharting.com/game/...` URLs and sends an honest generic `User-Agent` ("TreasureHoard personal collection tracker"). If PriceCharting blocks that, I'll report it rather than disguise the client.
  - The platform is pre-filled from the URL segment (`/game/nintendo-3ds/...`) and stays editable.
- **New library: cheerio.** It's a small HTML parser with jQuery-style selectors (`$('#used_price .js-price').first()`). It's already named in ARCHITECTURE.md, and it's sturdier than regexes when the markup shifts.

## 4. API (`lib/api/collection/*.ts`, mounted in `lib/api/app.ts`)

`createApp(db, deps = { fetch })`: external HTTP is injected, so the tests never touch the network.

| Method & path | Does |
|---|---|
| `GET /api/catalog/tcg/groups?game=` | The game's sets, newest first. `Cache-Control: private, max-age=86400`. |
| `GET /api/catalog/tcg/products?game=&groupId=` | Trimmed products merged with prices, for one set. `max-age=3600`. The browser filters it as you type. |
| `POST /api/catalog/pricecharting` `{url}` | One page fetch, returning `{name, platform, prices}`. |
| `GET /api/items?kind=&status=owned\|sold&q=` | Items with details, plus the **latest snapshot** per unit price and its date. Value = price × quantity; gain = value − basis. |
| `GET /api/items/:id` | One item, with its linked transactions and full snapshot history. |
| `POST /api/items` | kind, name, quantity, condition, notes, details, `acquisition: {mode:'purchase', date, costCents, fromAccountId} \| {mode:'baseline', date, valueCents}`, and an optional `observedPrice` (written as a snapshot, `on conflict do nothing`). The item, its details, the transaction and the snapshot are all written in **one database transaction**. |
| `PATCH /api/items/:id` | Name, condition, notes, details. A **cost basis or date** change rewrites the linked two-line acquisition transaction in the same database transaction. |
| `POST /api/items/:id/sell` | `{date, quantity, proceedsCents, toAccountId}`. A partial sale splits the row: the sold part becomes a new row (details copied, basis prorated) and the original keeps the rest. |
| `DELETE /api/items/:id/sale` | Undo a sale: deletes the sale transaction and clears the sold fields. Split rows are **not** merged back. |
| `DELETE /api/items/:id` | Unsold items only. Deletes the item and its acquisition transaction. |
| `GET /api/collection/check` | Invariant: Collection subtree balance vs the summed basis of unsold items, as `{ok, ledgerCents, itemsCents}`. |

**Ledger protection (change to existing routes):**
- `PUT` and `DELETE /api/transactions/:id` return **409** for a transaction linked to an item, with the message "Edit this from the collection item". The FK restriction backs up the delete case.
- `GET /api/transactions/:id` gains `linkedItemId`, so the transaction page can link to the item.

**Other existing routes:**
- `PATCH /api/accounts` refuses to **archive** accounts that have a `system_key`. Posting to archived accounts is blocked, so archiving them would break buying and selling.
- `GET /api/dashboard`:
  - `cashCents` now **excludes the Collection subtree**
  - adds `collectionCostCents` (net worth already includes it, because it's an asset)

## 5. Frontend

- **AppShell:** a Collection tab on desktop and mobile (Dashboard · Ledger · Collection · Add).
- **`/collection`:**
  - Owned / Sold toggle, kind chips, search, and sort by value, gain, name or date.
  - Summary line: item count, total cost, latest-known value and unrealized gain, with "prices as of …" noted.
  - Rows with a thumbnail (TCGplayer image) and a "since added" label for baseline items.
- **`/collection/new`:** one page in three sections.
  1. **What:** pick the kind, then the lookup:
     - **Card / sealed:** game → set (a searchable select, newest first) → type-to-filter product list with thumbnails and market prices per sub-type → pick the sub-type.
     - **Game / hardware:** paste the PriceCharting URL → **Look up** → title and loose/CIB/new prices → pick the variant. Or choose **"Not listed: price manually"**.
  2. **Details:** name (pre-filled), quantity, condition (a select of the usual grades), notes.
  3. **How you got it:**
     - **Bought it:** date, total cost, paid from (an AccountPicker).
     - **Already owned:** value pre-filled as market × quantity (editable), dated today.
- **`/collection/:id`:**
  - image, details, cost basis and source, latest price with its date, value, gain
  - links to the linked transactions
  - an **Edit** form
  - a **Sell** form (quantity, proceeds, date, deposit account; shows the gain live)
  - **Undo sale** and **Delete**
- **Transaction page:** for a linked transaction it shows "Belongs to <item>" with a link, and hides Save and Delete.
- **Settings:** a "Collection check" card (✓, or the two totals that differ).
- **Dashboard:** Cash excludes the Collection; a new "Collection (at cost)" stat.
- `src/lib/queries.ts` gets item, catalog and check hooks, and mutations invalidate items, accounts, transactions and the dashboard.

## 6. Tests

| File | Covers |
|---|---|
| `tests/collection/accounting.test.ts` | Each posting builder (balanced, zero lines left out); `splitBasis` remainders sum exactly |
| `tests/pricing/tcgcsv.test.ts` | Trim and merge from small inline JSON fixtures; null prices; float → cents edge cases (`19.89`, `0.1`, `256.03`); retry on an empty response; skipping future sets |
| `tests/pricing/pricecharting.test.ts` | `parsePriceChartingPage` on **`tests/fixtures/pricecharting/super-mario-world.html`** (fetched once and saved); the change span is ignored; missing prices → null; URL validation |
| `tests/api/collection.test.ts` | PGlite plus fake fetch. Purchase and baseline both move the Collection balance, and baseline is hidden as an opening entry. Full sale (gain), loss sale, partial sale (row split, prorated basis, sums exact). Undo sale. Basis edit rewrites the transaction. Delete. Linked-transaction PUT/DELETE → 409. Archiving a system account → 400. The invariant holds after every step. Dashboard cash excludes the collection. The seed adopts a pre-existing "Collection" account. |

## 7. Files

- **New:**
  - `lib/collection/accounting.ts`
  - `lib/pricing/{tcgcsv,pricecharting}.ts`
  - `lib/api/collection/{catalog,items,check}.ts`
  - `src/routes/{Collection,CollectionNew,ItemPage}.tsx`
  - `src/components/{TcgLookup,PriceChartingLookup,ItemList}.tsx`
  - the migration folder (generated plus custom seed)
  - the four test files and the HTML fixture
  - `docs/plans/03-collection.md`
- **Modified:**
  - `db/schema.ts`
  - `lib/api/app.ts` (fetch injection, new routes)
  - `lib/api/ledger/{transactions,accounts,dashboard}.ts` (protection, archive guard, cash)
  - `lib/ledger/types.ts`
  - `src/components/AppShell.tsx`
  - `src/main.tsx`
  - `src/routes/{TransactionPage,Settings,Dashboard}.tsx`
  - `src/lib/queries.ts`
  - `tests/api/harness.ts` (fake fetch)
  - `package.json` (cheerio)
  - `ARCHITECTURE.md` (item fields, price_snapshots timing, lookup fetch, ledger protection)

## 8. Order

1. Schema, migrations and local `db:migrate`.
2. Accounting helpers plus tests.
3. Pricing clients, the fixture and their tests.
4. Item and catalog API, ledger protection, plus integration tests.
5. Frontend: list, then add flow, then item page, then the Settings check and Dashboard.
6. Your check, then commit and push when you say.

## 9. Verification

- `npm test`, `npm run build`, `npm run lint`.
- `npm run db:status`, then `db:migrate`, locally.
- **Manual, in your own `npm run dev`** (I won't run a background dev server with altered secrets again):
  1. Add a One Piece card as already owned (check the pre-filled market value).
  2. Add a Riftbound sealed box as bought from Checking.
  3. Add a game by PriceCharting URL.
  4. Add your 3DS as hardware (by URL if listed, otherwise priced manually).
  5. Sell part of something.

  Then confirm the Collection account balances match Settings → Collection check, and that the purchase shows in the Checking register while the baseline entry stays hidden.
- After deploy: the summary shows the migration applied to production.
