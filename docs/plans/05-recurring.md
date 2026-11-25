# Plan: Step 5 — Recurring transactions and money owed to you

**Status:** approved 2026-11-25.

## Context

Bills and paychecks happen on a schedule, but today each one has to be entered by hand. Step 5 lets you describe them once and have them show up when due, for you to confirm. It also adds a small amount of support for **money owed to you**.

Your use case is the model for this step. You pay the utilities, and your roommate pays you back half. That's one recurring, variable bill whose cost is split between an expense and a receivable, plus the repayments that clear the receivable.

**Decisions so far (2026-11-24):**
- **Paychecks:** recorded as the net deposit only, one fixed amount.
- **Variable bills (utilities):** arrive with an estimate, and you enter the real amount when confirming.
- **Everything recurring is editable.** A raise means editing the paycheck template, and future paychecks use the new amount.
- **Month-end:** something due on the 31st falls on the last day of shorter months, and returns to the 31st when the month has one.
- **Due items arrive as `pending`, never `cleared`** (site map §7), including fixed paychecks. Confirming one is a single tap.

**Done when:**
- You can create, edit, pause and delete templates at `/ledger/recurring`, in simple or split form, with a weekly, monthly or yearly schedule.
- Due occurrences appear as pending transactions the next time you open the app, however long you've been away.
- The Dashboard lists what's due, with **Confirm**, **Edit** and **Skip**.
- Confirming a variable bill asks for the real total and rescales its split, so the roommate's half stays half.
- Editing a template changes future occurrences only.
- The Dashboard has an **"Owed to you"** card, with a **Record payment** action per person.
- Tests pass, and the migration applies on deploy.

**Not in this step:**
- Push or email reminders (deferred in the site map: they need extra setup).
- Automatically clearing fixed amounts without confirming.
- Aging buckets (30/60/90 days) and linking payments to specific bills.
- Reports (Step 7).

---

## 1. How your utilities case works

**One-time setup:**
- In Accounts, add a person under the new **Owed to me** account: **Owed to me : Roommate**.
- Create the template **Electric**:
  - every month on the 15th, **variable**, estimate $120
  - postings:

| Account | Amount |
|---|---|
| Checking | −$120 (paid out) |
| Utilities | +$60 (your half) |
| Owed to me : Roommate | +$60 (their half) |

**Each month:**
1. On the 15th, or the next time you open the app, a pending **Electric** transaction for the estimate appears under **Due** on the Dashboard.
2. You press **Confirm** and type the real bill, say $138.40. The split is rescaled to −$138.40 / +$69.20 / +$69.20 and saved as cleared.
3. When your roommate pays you, press **Record payment** next to their name in **Owed to you**. It opens a prefilled transfer (Owed to me : Roommate → Checking) for their balance, which you can change for a partial payment.

The receivable balance stays correct whether they pay monthly, late, or in a lump. It counts in your net worth, because it's money that's yours.

**Raise at work:** edit the **Paycheck** template's amount. Paychecks already generated stay as they were (edit those individually if needed). Everything from the next one on uses the new amount. A raise effective from a particular date only needs the template edited before that paycheck comes due.

## 2. Schema: `db/schema.ts` (one migration)

```
recurring_frequency  enum: week | month | year

recurring_templates
  id, description, notes,
  frequency recurring_frequency, interval int >= 1   -- every N weeks/months/years
  start_date date, end_date date null
  next_index int default 0      -- occurrence number of the next one to generate
  variable boolean default false  -- amount is an estimate, asked for on confirm
  active boolean default true     -- paused templates generate nothing
  created_at, updated_at

recurring_template_postings
  id, template_id → recurring_templates (cascade), account_id → accounts (restrict),
  amount_cents bigint (≠ 0), memo

transactions (existing, two new nullable columns)
  recurring_template_id → recurring_templates (on delete set null)
  occurrence_date date
  unique (recurring_template_id, occurrence_date)
```

**Why `next_index`, not a "next date":** each occurrence is computed from the start date. Occurrence *k* is the start date plus *k* × interval, with the day clamped to the end of the month. If each date were computed from the previous one instead, Jan 31 → Feb 28 would continue as Mar 28 forever, because the 31st is lost after the first short month.

**Why the unique key:** if two browser tabs open at once, both may try to generate the same occurrence. The second insert hits the key and does nothing, so you never get a duplicate bill.

**The Owed to me account:** the migration creates a top-level asset account **Owed to me** with `system_key = 'receivables'`, the same mechanism that protects Opening Balances. If you already have a top-level account named exactly "Owed to me", the migration adopts it rather than failing on the unique name. Its children are the people who owe you, and you add them in Accounts as usual.
- **Alternative:** a "receivable" checkbox on any account. That's more flexible but means another setting to remember. One parent account matches how you'd organize it anyway. It's renamable, but it can't be deleted.

**Template balance check:** the postings must sum to zero. This is checked in the API with the same `validatePostings` used for transactions. The database-level balance trigger stays on transactions only, since templates never touch balances.

## 3. Logic: `lib/ledger/recurring.ts` (pure functions where possible, unit-tested)

- **`occurrenceDate(start, frequency, interval, k)`:** the k-th date, with month-end clamping.
- **`generateDue(db, today)`:** for each active template whose next occurrence is on or before `today`, and not after its end date:
  - insert a pending transaction dated on that occurrence, copying the template's **current** postings, using `on conflict do nothing`
  - advance `next_index`
  - repeat until the template is caught up
  - all of it runs in one database transaction
  - capped at **60 occurrences per template per call**, so a template accidentally started years ago can't flood the ledger. The rest come on the next load.
  - **Variable templates:** the estimate is the **last confirmed occurrence's postings**, rescaled to that occurrence's total. Until the first confirmation, it's the template's own amount. So a utility bill's estimate follows recent reality.
- **`rescaleToTotal(postings, totalCents)`:** used when confirming a variable bill.
  - The **paying** line is the single posting on the opposite side from all the others, e.g. Checking −$120. It becomes the new total.
  - The other lines are scaled proportionally. Rounding uses the largest-remainder method, so they sum to exactly the total: $138.41 splits as $69.21 / $69.20, never off by a cent.
  - If no single line is the paying side (e.g. two accounts on each side), it returns null. The UI then opens the full split editor instead of the one-amount box.
- **`nextOccurrences(template, after, count)`:** upcoming dates, for display.

**When generation runs, and why on request:**
- The app shell calls `POST /api/recurring/catch-up { today }` once when the app opens, sending your **local** date. If anything was created, it refreshes the ledger and dashboard data.
- **Alternatives:**
  - Running generation inside every API read would use the server's UTC date. That would make a bill due tomorrow appear this evening in US time.
  - A scheduled job would wake the database daily for no reason (credit budget).
- Nothing is generated until you open the app. That's the lazy design from the site map, and the Dashboard is the only place you'd see a due item anyway.

## 4. API (`lib/api/ledger/recurring.ts`, mounted at `/api/recurring`)

| Method & path | Does |
|---|---|
| `GET /api/recurring` | All templates with postings, schedule, next due date, the next 3 dates, and the number of pending occurrences |
| `GET /api/recurring/:id` | One template |
| `POST /api/recurring` | Create. The postings must balance; the schedule is validated (interval ≥ 1, end date not before start) |
| `PUT /api/recurring/:id` | Edit. Affects **future occurrences only**. Changing the schedule restarts counting from the first date after the last one already generated, so editing never re-creates past bills. Pause and resume set `active` |
| `DELETE /api/recurring/:id` | Delete the template. Transactions it already made stay; they just lose the link |
| `POST /api/recurring/catch-up` `{today}` | Run `generateDue` and return `{ created }` |
| `GET /api/dashboard` (existing) | Adds `recurring.due` (pending recurring transactions, oldest first), `recurring.upcoming` (the next 7 days, not generated yet), and `owedToYou` (children of Owed to me with a non-zero balance, plus the date of each person's last payment) |

**Confirming** uses the existing `PUT /api/transactions/:id` with `status: 'cleared'` and the possibly rescaled postings. No new endpoint: the frontend calls `rescaleToTotal` (shared code) and saves as normal. **Skipping** deletes the pending transaction. `next_index` has already moved past it, so it isn't regenerated.

**Pending amounts and balances:** existing behavior is unchanged. Account balances and net worth include pending transactions, and the register shows the cleared balance separately. So an estimated bill counts as soon as it's due, which is when you owe it.

## 5. Frontend

- **`/ledger/recurring`** (new route; the Ledger sub-nav gains **Recurring**):
  - **List:** each template's description, amount (marked "about" for variable ones), schedule in words ("Monthly on the 15th", "Every 2 weeks on Friday"), next due date and a paused badge.
  - **Editor:**
    - the same simple/split entry as transactions
    - plus frequency, interval, start date, optional end date, "Amount varies" and Active
    - previews the next 3 dates live, so month-end clamping is visible before you save
- **Refactor, called out:** the simple/split postings entry moves from `TransactionForm.tsx` into a shared `PostingsEditor.tsx`. Both forms then use it. Without this, there would be a second copy of the split grid and balance counter.
- **Transaction page:** a **Make recurring** button that opens the template editor prefilled from that transaction. This is the quickest way to set up your existing bills.
- **Dashboard:**
  - **Due** card:
    - **Confirm:** fixed amounts clear in one tap. Variable ones ask for the total and show the rescaled split before saving.
    - **Edit:** opens the transaction.
    - **Skip:** asks before deleting.
    - **Coming up:** the next 7 days, in muted text.
  - **Owed to you** card: one line per person with their balance and last payment date, plus **Record payment**. That opens `/ledger/new` prefilled with the transfer, which you can edit for partial payments.
- **Register:** recurring transactions show a small ↻ marker linking to their template.
- **App shell:** the catch-up call on load.

## 6. Tests

| File | Covers |
|---|---|
| `tests/ledger/recurring.test.ts` | `occurrenceDate`: monthly on the 31st through February (including a leap year) and back to the 31st; weekly; every 2 weeks; yearly from Feb 29. `rescaleToTotal`: the 50/50 split stays exact on odd cents; it returns null when there's no single paying line. |
| `tests/api/recurring.test.ts` | Create, validate and edit templates. Catch-up: creates only due occurrences, as pending, correctly dated; running it twice creates nothing new; the 60-per-call cap holds; end date and pause are honoured; a template edit affects only later occurrences; a schedule edit doesn't re-create past ones; the variable estimate follows the last confirmed amount. Skip doesn't regenerate. Deleting a template keeps its transactions. Dashboard: `due`, `upcoming`, `owedToYou`. The Owed to me account exists and can't be deleted. |

## 7. Files

**New**
- `docs/plans/05-recurring.md`
- the migration folder
- `lib/ledger/recurring.ts`
- `lib/api/ledger/recurring.ts`
- `src/routes/Recurring.tsx`
- `src/components/RecurringForm.tsx`
- `src/components/PostingsEditor.tsx`
- `src/components/DueCard.tsx`
- `src/components/OwedToYou.tsx`
- the two test files

**Modified**
- `db/schema.ts`
- `lib/ledger/schemas.ts` (template schemas)
- `lib/ledger/types.ts`
- `lib/api/app.ts`
- `lib/api/ledger/dashboard.ts`
- `lib/api/ledger/transactions.ts` (returns `recurringTemplateId`)
- `src/main.tsx` (route)
- `src/components/AppShell.tsx` (catch-up, sub-nav)
- `src/components/TransactionForm.tsx` (uses `PostingsEditor`; accepts prefill)
- `src/components/TransactionList.tsx` (↻ marker)
- `src/routes/TransactionPage.tsx` (Make recurring)
- `src/routes/Dashboard.tsx`
- `src/lib/queries.ts`
- `ARCHITECTURE.md`: the template tables, `next_index` and month-end rule, the catch-up call, the Owed to me account

## 8. Credit cost

None to speak of. There's no scheduled job: generation is one small query when you open the app, which already wakes the database.

## 9. Order

1. Schema and migration, then the pure date and rescale functions with their tests.
2. `generateDue` and the API, with their tests.
3. The `PostingsEditor` refactor, checking that the transaction form still behaves the same.
4. The Recurring page and editor, then the Dashboard cards, Make recurring, and the register marker.
5. You check it. Then commit, and push when you say.

## 10. Verification

- `npm test`, `npm run build`, `npm run lint`; `db:migrate` locally.
- **Manual, in your `npm run dev`:**
  1. Add **Owed to me : Roommate**. Create a monthly **Electric** template, variable, with the three-line split and a start date last month. On reload, two pending bills appear under **Due**.
  2. Confirm one with an odd total and check the halves.
  3. Use **Record payment** for the roommate and check the balance drops.
  4. Create a **Paycheck** template. Edit its amount and check that only new occurrences change.
  5. Create a template due on the 31st and check that the preview shows Feb 28 (or 29), then Mar 31.
