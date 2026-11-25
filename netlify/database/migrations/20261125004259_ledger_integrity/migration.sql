-- Hand-written migration (drizzle-kit generate --custom): rules and data that
-- db/schema.ts can't express. Never edit this file once it has been deployed.

-- 1. Balance backstop ---------------------------------------------------------
-- Every transaction must have at least two postings that sum to zero. The API
-- checks this first; these triggers make it impossible even for code that
-- bypasses the API. They are DEFERRABLE INITIALLY DEFERRED, so the check runs
-- at COMMIT: within a database transaction, postings can be inserted one row
-- at a time, and only the final state has to balance.

CREATE FUNCTION ledger_assert_balanced(txn_id integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
  n integer;
BEGIN
  -- The transaction was deleted in this same commit (its postings cascade): nothing to check.
  IF NOT EXISTS (SELECT 1 FROM transactions WHERE id = txn_id) THEN
    RETURN;
  END IF;
  SELECT coalesce(sum(amount_cents), 0), count(*) INTO total, n
    FROM postings WHERE transaction_id = txn_id;
  IF n < 2 THEN
    RAISE EXCEPTION 'Transaction % has % posting(s); at least 2 are required', txn_id, n
      USING ERRCODE = 'check_violation';
  END IF;
  IF total <> 0 THEN
    RAISE EXCEPTION 'Transaction % is unbalanced: postings sum to % cents', txn_id, total
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION ledger_postings_balance_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM ledger_assert_balanced(NEW.transaction_id);
  END IF;
  -- On DELETE, or an UPDATE that moved a posting to another transaction,
  -- the old transaction must still balance too.
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.transaction_id <> NEW.transaction_id) THEN
    PERFORM ledger_assert_balanced(OLD.transaction_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER postings_balanced
  AFTER INSERT OR UPDATE OR DELETE ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_postings_balance_trigger();
--> statement-breakpoint

-- Also catches a transaction inserted with no postings at all, which the
-- postings trigger alone would never see.
CREATE FUNCTION ledger_transactions_balance_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER transactions_balanced
  AFTER INSERT ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_transactions_balance_trigger();
--> statement-breakpoint

-- 2. Starter chart of accounts -----------------------------------------------
-- Runs once per database. Everything here can be renamed, nested, or archived
-- in the app; only Opening Balances (system_key) is protected from deletion.
-- Collection accounts are added in Step 3.

INSERT INTO accounts (name, type, system_key) VALUES
  ('Checking',         'asset',     NULL),
  ('Savings',          'asset',     NULL),
  ('Credit Card',      'liability', NULL),
  ('Opening Balances', 'equity',    'opening_balances'),
  ('Salary',           'income',    NULL),
  ('Other Income',     'income',    NULL),
  ('Groceries',        'expense',   NULL),
  ('Dining',           'expense',   NULL),
  ('Housing',          'expense',   NULL),
  ('Utilities',        'expense',   NULL),
  ('Transport',        'expense',   NULL),
  ('Subscriptions',    'expense',   NULL),
  ('Entertainment',    'expense',   NULL),
  ('Health',           'expense',   NULL),
  ('Shopping',         'expense',   NULL),
  ('Other',            'expense',   NULL);
