# Plan: Groups, card search by name, decklist import, and quantity edits

**Status:** approved 2026-11-25, with the import's "copies you already own" rule as revised below.

## Context

Getting the collection in is the priority now. Entering a 100-card Commander deck exposed three problems:

1. **Editing a card's quantity creates fake gain.** The cost basis is a total for the row, so 1 × $10 edited to 2 copies shows $20 market value against $10 cost: +$10 of "gain" that isn't real.
2. **There's no way to treat a deck as one thing.** The Ghalta deck is 100 separate tiles with no total.
3. **Finding a card means knowing its set first.** The lookup goes game → set → card, and many cards don't make their set obvious.
4. **Entering a deck card by card is slow.** A deck that already exists in a deckbuilder (Moxfield, Archidekt) should be pasted in, with its exact printings.

**Done when:**
- Changing an item's quantity keeps its cost per unit (shown before saving, and can be overridden).
- Items can belong to one **group** (a deck, a binder…). The Collection page has a **Grouped / Individual** toggle; grouped view shows each group as one tile with its total value, cost and gain.
- A group's page lists its cards with their own prices. Cards can be added (including many at once from the Collection page), removed, and the cover chosen.
- On Add item, you can **search cards by name across every set** of a game. Results show each printing (set, collector number, rarity, image), so the exact printing is picked by sight. Browsing by set still works.
- Adding cards one after another into the same deck is quick: **Save and add another**, which keeps the game and the group.
- **Decklist import:** paste a Magic decklist, review what each line matched (with images), fix any line, and add the lot in one go as cards you already own, into a group.

**Deferred** (added to the build order):
- **Sell a whole group** for one price, split across its cards by market value.
- **Buy a whole deck** (e.g. a precon) for one price, with cost split across the cards the same way.
- The **wishlist** and **push notifications** (deferred earlier).

---

## 1. Quantity edits keep the cost per unit

Front end only (`src/routes/ItemPage.tsx`, the edit form).

- When you change Quantity and haven't touched Cost basis, the cost field follows: new cost = old cost ÷ old quantity × new quantity, rounded to the cent. A note under it says "Cost updated to keep $10.00 each."
- If you type in Cost basis yourself, it stops following. That covers a purchase entered with the right total but the wrong quantity.
- The server and ledger logic are unchanged. The new cost goes through the existing path, which updates the linked ledger entry.

## 2. Groups

### Schema (one migration)

```
item_groups
  id, name (unique), notes,
  cover_item_id → items (on delete set null)  -- the picture on its tile; null = its most valuable card
  created_at

items (existing)
  group_id → item_groups (on delete set null)  -- one group per item
```

- **The ledger is untouched.** Each card stays its own item with its own cost, price and gain, and a group just adds them up.
  - **Alternative considered:** a deck as one item with one price. It would lose per-card pricing, and nothing prices a custom deck as a whole.
- **Deleting a group** leaves its cards in the collection, ungrouped.
- **Sold cards keep their group** for history, but group totals count unsold cards only. When part of an item is sold, the sold portion is split off as its own item, and that copy keeps the group too.

### API (`lib/api/collection/groups.ts`, mounted at `/api/groups`)

| Method & path | Does |
|---|---|
| `GET /api/groups` | Each group with its card count (sum of quantities), cost, market value, gain, 7-day change and cover image |
| `GET /api/groups/:id` | One group with the same totals and its items (the same item shape as `/api/items`) |
| `POST /api/groups` `{name, notes?}` | Create |
| `PATCH /api/groups/:id` | Rename, notes, set or clear the cover |
| `DELETE /api/groups/:id` | Delete; its cards become ungrouped |
| `POST /api/groups/:id/items` `{itemIds}` | Put items in this group (moving them out of any other) |
| `PATCH /api/items/:id` (existing) | Gains `groupId` (null = ungroup) |
| `POST /api/items` (existing) | Gains optional `groupId` |
| `GET /api/items` (existing) | Each item gains `groupId` and `groupName`; new filter `groupId` (or `none`) |

Group totals reuse the Step 4 valuation rules (`lib/collection/valuation.ts`): never-priced cards count at cost.

### Frontend
- **Collection page:** a **Grouped / Individual** toggle next to Tiles / List, remembered like the view toggle.
  - **Grouped** shows group tiles first, then items that aren't in a group.
  - A **group tile** shows its cover image (or its most valuable card's image), name, number of cards, market value, gain and 7-day change.
  - **Individual** is today's view. Each item gets a small group label.
- **Select mode** on the Collection page: tick items, then **Add to group…** (an existing group or a new one). This is how the Ghalta cards you've already entered go into a deck in one go.
- **Group page** (`/collection/groups/:id`):
  - totals at the top
  - the cards, by value, in tiles or list
  - movers within the group
  - rename, notes and delete
  - **Use as cover** on any card
  - remove from group
- **Item page:** shows its group with a link, and the edit form has a Group select.
- **Add item:** a **Group** select at the end of the form, and **Save and add another**. The latter stays on the form with the game, mode (card or sealed) and group kept, and clears the card. Entering a deck becomes: search a name → pick the printing → Save and add another.

## 3. Card search by name

### Why a local index

**TCGCSV has no search.** It serves one product file per set (459 sets for Magic alone), so finding a card by name means having every set's products on hand. Two options were checked (2026-11-25):

| Option | Verdict |
|---|---|
| **Scryfall** (a free Magic card database with a search API; each printing carries its TCGplayer product id) | Great Magic search, but it doesn't say which TCGplayer **set** (group) a product is in, and the app needs that to price it. Matching Scryfall set codes to TCGCSV sets by code or name works for only about a third of paper sets: promos, The List and Secret Lair-style products mostly don't match. It also doesn't cover One Piece or Riftbound. |
| **Our own index of TCGCSV's catalog** | One source for all three games, matching exactly the products and printings the prices come from. **Chosen.** |

### The index

```
catalog_groups     group_id (PK), category_id, name, abbreviation, published_on,
                   modified_on, products_synced_at
catalog_products   product_id (PK), category_id, group_id, name, number, rarity,
                   image_url, sealed
                   index on (category_id, lower(name))
```

- **Built by a new sync job, `catalog`.** It uses the same two-halves design, background function, `sync_runs` row and Settings card as price syncs (Step 4).
  - **First build:** every set of the three games, about 520 product files. One request every 0.5 s keeps it polite to TCGCSV, so it takes about 5 minutes, within the 15-minute background limit.
  - **Refreshes** fetch only sets whose `modified_on` changed, plus new sets. They run weekly with the Monday games sync, so new releases appear within a week.
  - **Refresh now** in Settings works as it does for prices.
- **Size:** a large set's product file is about 50 KB compressed (Secret Lair is about 0.9 MB). The index is roughly 120,000 rows, a few tens of MB. That fits the free database comfortably, but **it's the first sizeable chunk of storage**, so I'll report the real size after the first build.
- **Search** (`GET /api/catalog/tcg/search?game=mtg&q=ghalta`) is a case-insensitive "contains" match on the name.
  - Results are sorted by exact match, then names starting with the query, then the rest, then newest set first.
  - Capped at 60 results; cards or sealed per the current mode; it can be narrowed to one set.
  - Each result: product id, set name, collector number, rarity, image.
- **Picking a result** loads that set's products and prices with the existing lookup (already cached for an hour) and selects the product. Sub-type (Normal or Foil) and price then work exactly as they do now. Prices still come live from TCGCSV, not from the index.
- **Before the first build,** the search box says the index isn't built yet, with a button to build it. Browsing by set works throughout.

### Credits
- The first build is one background run of about 5 minutes, then a small weekly refresh: a fraction of a credit.
- The weekly refresh rides on the Monday sync's database wake.

## 4. Decklist import

Built on the catalog index (section 3). Magic first, because that's where deckbuilder exports exist. One Piece and Riftbound lists in the plain `4 Card Name` form still work, through name matching.

### What it reads

`lib/collection/decklist.ts` is a pure parser, unit-tested against real export samples saved as fixtures.

| Form | Example |
|---|---|
| Moxfield export | `1 Ghalta, Primal Hunger (RIX) 130 *F*` |
| Archidekt export | `1x Ghalta, Primal Hunger (rix) 130 *F* [Commander{top}]` |
| MTG Arena | `1 Ghalta, Primal Hunger (RIX) 130` |
| Name only | `1 Ghalta, Primal Hunger` |

- **Finish markers:** `*F*` = foil, `*E*` = foil etched. No marker = non-foil.
- **Ignored:** section headers (`Commander`, `Deck`, `Sideboard`, `Maybeboard`…), blank lines, `//` comments, and Archidekt's `[Category]` tags.
- **Duplicates combine:** the same printing and finish on several lines becomes one line with the summed quantity.

### How a line is matched (`lib/collection/decklistMatch.ts`, using the index)

In order, stopping at the first that gives exactly one product:

1. **Set code + collector number:** the set code against TCGplayer's set abbreviation, then the number within that set. This covers ordinary sets and Secret Lair (`SLD`).
2. **Name + collector number** across all sets. This catches promos and The List, whose set codes don't line up with TCGplayer's sets: a promo `(PRIX) 130s` is found by name and number.
3. **Name only:** if exactly one printing exists, it's used. Otherwise the line is **not matched** and lists its candidate printings.

**Finish:** foil maps to TCGplayer's Foil sub-type. Foil etched prefers the product named "(Foil Etched)" in that set, which is how TCGplayer lists etched cards.

Each line is shown as one of:
- **matched**
- **guessed:** matched, but not by set code + number
- **choose:** more than one printing; pick one
- **not found**

### The review screen (`/collection/import`, from a button on the Collection page)

1. **Paste** the list. Choose the group (an existing one or a new one, e.g. "Ghalta"), the default condition, and the date (today).
2. **Review:** one row per line, showing quantity, image, name, set and number, finish, condition, unit price and line total. The grand total is at the top.
   - Rows marked **guessed**, **choose** or **not found** sort first.
   - Any row can be changed with the same name-search picker as Add item, or removed.
   - **Prices** load set by set from the browser, through the existing per-set lookup. Each request stays short, and sets already looked up are cached.
   - **Copies you already own** (same printing and finish). For each row, in order:
     1. Copies **already in the target group** count as present, and only the shortfall is imported. This makes re-importing the same list safe.
     2. Copies **in no group** are used next: they're moved into the group rather than duplicated. This covers cards entered by hand before groups existed.
     3. Anything still missing is added **new**.
     4. Copies **in other groups are never touched**; the row notes them ("you also own 1 in Ghalta"). A Beast Within in one deck doesn't stop another deck getting its own copy.

     Each row shows the split ("1 already in deck · 1 from ungrouped · 1 new"), and it can be overridden to add everything new.
3. **Import:** enabled once every row is matched and priced.

### Booking

Imported cards are **cards you already own**: each is booked at its market value on the import date (an opening-balance entry, the same as adding one by hand as "already owned"). Buying a deck for one price is still deferred.

**Matching** happens on the server, because it needs the index: `POST /api/collection/import/preview { text }` returns each parsed line with its status, match and candidate printings, plus how many of that printing you already own. It only reads, so it's quick.

`POST /api/collection/import` takes `{ lines: [{ categoryId, groupId, productId, subType, setName, number, rarity, imageUrl, name, quantity, condition, priceCents }], date, itemGroupId | newGroupName }`:
- It creates every item, its opening entry and its price snapshot **in one database transaction**: all or nothing.
- It uses the same insert code as `POST /api/items`, so imported items are identical to hand-entered ones.
- Up to 250 lines.
- A card with no market price at all is refused with that line named. It can be added by hand with a manual value.

**Why prices are fetched by the browser before importing:** a 100-card deck can span 50+ sets. Fetching them all inside one API call could run past the function's time limit. Fetching from the browser set by set keeps every call short, and you see the prices before committing.

## 5. Tests

| File | Covers |
|---|---|
| `tests/api/groups.test.ts` | Create, rename, delete (cards stay, ungrouped). Totals: cost, market, never-priced at cost, sold cards excluded. Bulk add moves cards from another group. Cover and the fallback cover. `groupId` on items and the `groupId=none` filter. A partial sale's sold copy keeps its group. Unique names. |
| `tests/pricing/catalog.test.ts` | First build indexes every set (fake fetch). The refresh fetches only changed and new sets. One bad set file doesn't stop the rest. Requests are paced. Sealed products are flagged. |
| `tests/api/catalog-search.test.ts` | Name search: ranking, the card/sealed filter, the set filter, the cap, case-insensitivity, the empty-index response. |
| `tests/collection/decklist.test.ts` | The parser on saved Moxfield, Archidekt, Arena and plain-name samples: quantities, set codes, numbers like `130s` and `RIX-130`, finish markers, headers, tags and comments ignored, duplicates combined. |
| `tests/api/decklist-import.test.ts` | Matching against a seeded index: set + number, the promo fallback by name + number, a single printing, ambiguous and not found, foil etched. Import: items, opening entries and snapshots are created; the new group; an existing group; all or nothing when one line is bad; the line cap; copies already in the group, moved from ungrouped, and other groups untouched. |

The quantity-edit change is in the front end only. The existing tests cover the server path it uses.

## 6. Files

**New**
- `docs/plans/07-groups-and-search.md`
- two migrations: groups, and the catalog index plus the `catalog` sync job value
- `lib/api/collection/groups.ts`
- `lib/pricing/catalog.ts`: index build and refresh
- `src/routes/GroupPage.tsx`
- `src/components/GroupTile.tsx`
- `src/components/AddToGroup.tsx`: the picker used by select mode and the item page
- `lib/collection/decklist.ts`: the parser
- `lib/collection/decklistMatch.ts`: matching against the index
- `lib/api/collection/import.ts`: match preview and import routes
- `src/routes/DecklistImport.tsx`: paste, review, import
- `src/components/CardSearch.tsx`: the name-search picker, shared by Add item and the import review
- `tests/fixtures/decklists/`: saved export samples
- the five test files

**Modified**
- `db/schema.ts`
- `lib/pricing/sync.ts`: the `catalog` job
- `lib/pricing/types.ts`
- `netlify/functions/price-sync-schedule.mts`: catalog refresh on Mondays
- `lib/api/prices.ts`: status and Refresh now for the catalog job
- `lib/api/collection/catalog.ts`: the search route
- `lib/api/collection/items.ts`: `groupId` on create, edit, list and partial sale
- `lib/collection/schemas.ts`, `lib/collection/types.ts`
- `lib/api/app.ts`
- `src/components/TcgLookup.tsx`: name search, with browse-by-set kept
- `src/components/ItemList.tsx`: group label; select mode
- `src/components/PriceSync.tsx`: the catalog job line
- `src/routes/Collection.tsx`: Grouped / Individual toggle, select mode
- `src/routes/CollectionNew.tsx`: group select, Save and add another
- `src/routes/ItemPage.tsx`: quantity keeps cost per unit; group link and select
- `src/lib/queries.ts`
- `src/main.tsx`: the group route
- `ARCHITECTURE.md`: groups, the catalog index, the build order with the deferred items

## 7. Order

1. Quantity edit fix (small, on its own).
2. Groups: schema, API and tests, then the Collection toggle, group page, select mode and item page.
3. Catalog index: schema, sync job and tests, then search and the lookup UI, then Save and add another.
4. Decklist import: parser and matcher with their tests, then the import route, then the review screen.
5. You check it. Then commit, and push when you say.

## 8. Verification

- `npm test`, `npm run build`, `npm run lint`; `db:migrate` locally.
- **I'll build the catalog index once against your local database,** with real TCGCSV requests (public data only). I'll report the time, row count and table size.
- **Manual, in your `npm run dev`:**
  1. Edit a card's quantity and check the cost follows and the gain doesn't jump.
  2. Collection → Select → tick the Ghalta cards → Add to group → new group "Ghalta". Switch to Grouped and check the deck is one tile with the right total.
  3. On the group page, set Ghalta as the cover.
  4. Add item → search "ghalta" and check every printing is listed with its set and image. Pick one, then Save and add another into the Ghalta group.
  5. Export the Ghalta deck from your deckbuilder (if it's in one) and paste it into Import.
     - The cards you already entered should show as already in the deck (if grouped) or as moved from ungrouped.
     - Check the guessed and choose rows, then the total.
     - Import into a test group first if you'd rather not touch the real deck. Deleting a group leaves its cards, so the imported test cards would then need deleting from the Collection.
