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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('transactions_date_id_idx').on(t.date.desc(), t.id.desc())],
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
