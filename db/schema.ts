// Drizzle table definitions: the source of truth for the database schema.
// After changing this file, run `npm run db:generate` to produce a SQL
// migration in netlify/database/migrations/, then `npm run db:migrate` to
// apply it to the local database.
//
// Some rules can't be expressed here and live in hand-written migrations:
// the deferred trigger that keeps every transaction balanced, and the seeded
// starter chart of accounts (see the `ledger_integrity` migration).

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

// --- Ledger -----------------------------------------------------------------

export const accountType = pgEnum('account_type', [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
])
export const txnStatus = pgEnum('txn_status', ['pending', 'cleared'])
// `opening` marks fresh-start balance entries, hidden from the register by default.
export const txnKind = pgEnum('txn_kind', ['normal', 'opening'])

export const accounts = pgTable(
  'accounts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    type: accountType().notNull(),
    parentId: integer('parent_id'),
    // Stable handle for accounts the app itself relies on (e.g. 'opening_balances'),
    // so renaming them never breaks anything. Such accounts can't be deleted.
    systemKey: text('system_key').unique(),
    archived: boolean().notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete(
      'restrict',
    ),
    // No two siblings share a name, including at the top level (parent_id null).
    unique('accounts_parent_name_unique')
      .on(t.parentId, t.name)
      .nullsNotDistinct(),
  ],
)

export const transactions = pgTable(
  'transactions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // A calendar date, kept as 'YYYY-MM-DD' text in JS so timezones never shift it.
    date: date({ mode: 'string' }).notNull(),
    description: text().notNull(),
    notes: text(),
    status: txnStatus().notNull().default('cleared'),
    kind: txnKind().notNull().default('normal'),
    // Set by bank import later (FITID or a content hash); unique so re-imports are harmless.
    externalId: text('external_id').unique(),
    // Set when a recurring template generated this transaction (Step 5).
    // The template link is dropped if the template is deleted; the transaction stays.
    recurringTemplateId: integer('recurring_template_id').references(
      () => recurringTemplates.id,
      { onDelete: 'set null' },
    ),
    // Which of the template's occurrences this is (its due date). With the
    // unique key below, an occurrence can never be generated twice.
    occurrenceDate: date('occurrence_date', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('transactions_date_id_idx').on(t.date.desc(), t.id.desc()),
    unique('transactions_occurrence_unique').on(
      t.recurringTemplateId,
      t.occurrenceDate,
    ),
  ],
)

export const postings = pgTable(
  'postings',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    // Integer cents. Positive = debit, negative = credit. A JS number is exact
    // up to ~$90 trillion, which avoids BigInt handling throughout the app.
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    memo: text(),
  },
  (t) => [
    check('postings_amount_nonzero', sql`${t.amountCents} <> 0`),
    index('postings_account_idx').on(t.accountId),
    index('postings_transaction_idx').on(t.transactionId),
  ],
)

// --- Recurring transactions ---------------------------------------------------
// A template is a transaction to repeat on a schedule. Due occurrences are
// generated lazily (when the app opens) as pending transactions. See
// lib/ledger/recurring.ts for the date rules.

export const recurringFrequency = pgEnum('recurring_frequency', [
  'week',
  'month',
  'year',
])

export const recurringTemplates = pgTable(
  'recurring_templates',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    description: text().notNull(),
    notes: text(),
    frequency: recurringFrequency().notNull(),
    interval: integer().notNull().default(1), // every N weeks/months/years
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    // Occurrence k falls on start + k × interval (month ends clamped). This is
    // the number of the next one to generate. Counting from the start, rather
    // than stepping from the previous date, keeps the 31st from drifting to the 28th.
    nextIndex: integer('next_index').notNull().default(0),
    // The amount is an estimate (utilities): asked for when confirming.
    variable: boolean().notNull().default(false),
    // Paused templates generate nothing.
    active: boolean().notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('recurring_interval_positive', sql`${t.interval} >= 1`),
    check(
      'recurring_end_after_start',
      sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
  ],
)

// The template's postings, copied onto each occurrence. Same rules as postings.
export const recurringTemplatePostings = pgTable(
  'recurring_template_postings',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    templateId: integer('template_id')
      .notNull()
      .references(() => recurringTemplates.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    memo: text(),
  },
  (t) => [
    check('recurring_postings_amount_nonzero', sql`${t.amountCents} <> 0`),
    index('recurring_postings_template_idx').on(t.templateId),
  ],
)

// --- Collection ---------------------------------------------------------------
// Items are booked into the ledger as assets at cost (see ARCHITECTURE.md,
// "Collection accounting"). Market value lives in price_snapshots, never in
// the ledger.

export const itemKind = pgEnum('item_kind', [
  'card',
  'sealed',
  'game',
  'hardware',
])
// purchase = real cost; baseline = market value on the day it was added (fresh start).
export const basisSource = pgEnum('basis_source', ['purchase', 'baseline'])
export const gameVariant = pgEnum('game_variant', ['loose', 'cib', 'new'])
export const priceSource = pgEnum('price_source', [
  'tcgcsv',
  'pricecharting',
  'manual',
])

export const items = pgTable(
  'items',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    kind: itemKind().notNull(),
    name: text().notNull(),
    quantity: integer().notNull().default(1),
    condition: text(),
    notes: text(),
    // Total for the row's whole quantity, not per unit.
    costBasisCents: bigint('cost_basis_cents', { mode: 'number' }).notNull(),
    basisSource: basisSource('basis_source').notNull(),
    acquiredDate: date('acquired_date', { mode: 'string' }).notNull(),
    // The purchase or opening entry that put the item on the books. Null when
    // the basis is $0 (nothing to book). Restrict: a linked transaction can't
    // be deleted out from under its item.
    acquiredTxnId: integer('acquired_txn_id').references(
      () => transactions.id,
      { onDelete: 'restrict' },
    ),
    soldTxnId: integer('sold_txn_id').references(() => transactions.id, {
      onDelete: 'restrict',
    }),
    // Set when sold (or given away). sold_txn_id can be null for a $0 sale of a
    // $0 item, so this date is what marks an item as sold.
    soldDate: date('sold_date', { mode: 'string' }),
    saleProceedsCents: bigint('sale_proceeds_cents', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('items_quantity_positive', sql`${t.quantity} > 0`),
    check('items_basis_nonnegative', sql`${t.costBasisCents} >= 0`),
    index('items_acquired_txn_idx').on(t.acquiredTxnId),
    index('items_sold_txn_idx').on(t.soldTxnId),
  ],
)

// Cards and sealed product, priced from TCGCSV (TCGplayer data).
export const cardDetails = pgTable(
  'card_details',
  {
    itemId: integer('item_id')
      .primaryKey()
      .references(() => items.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id').notNull(), // TCGplayer game: 1 MTG, 68 One Piece, 89 Riftbound
    groupId: integer('group_id').notNull(), // TCGplayer set
    tcgplayerProductId: integer('tcgplayer_product_id').notNull(),
    subType: text('sub_type'), // e.g. Normal, Foil
    setName: text('set_name').notNull(),
    number: text(),
    rarity: text(),
    imageUrl: text('image_url'),
  },
  (t) => [index('card_details_group_idx').on(t.categoryId, t.groupId)],
)

// Games and hardware, priced from PriceCharting (or by hand when url is null).
export const gameDetails = pgTable('game_details', {
  itemId: integer('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  platform: text().notNull(),
  pricechartingUrl: text('pricecharting_url'),
  variant: gameVariant().notNull(),
  imageUrl: text('image_url'),
})

// Append-only price history, keyed by product (not item), so copies share it.
//   tcgcsv:        external_id = TCGplayer product ID, variant = sub-type
//   pricecharting: external_id = URL path,             variant = loose | cib | new
//   manual:        external_id = 'item:<id>',          variant = ''
export const priceSnapshots = pgTable(
  'price_snapshots',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    source: priceSource().notNull(),
    externalId: text('external_id').notNull(),
    variant: text().notNull().default(''),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    asOf: date('as_of', { mode: 'string' }).notNull(),
  },
  (t) => [
    unique('price_snapshots_key').on(t.source, t.externalId, t.variant, t.asOf),
  ],
)

// --- Price sync -------------------------------------------------------------

// tcg: TCGCSV card and sealed prices (daily). games: PriceCharting (weekly).
export const syncJob = pgEnum('sync_job', ['tcg', 'games'])
// partial: some targets failed, the rest were updated.
export const syncStatus = pgEnum('sync_status', [
  'running',
  'ok',
  'partial',
  'failed',
])

// One row per sync run, for the Settings health card and the stale-price notice.
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    job: syncJob().notNull(),
    trigger: text().notNull(), // 'schedule' | 'manual'
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: syncStatus().notNull().default('running'),
    okCount: integer('ok_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    error: text(), // first few failures, one per line
  },
  (t) => [index('sync_runs_job_idx').on(t.job, t.startedAt)],
)
