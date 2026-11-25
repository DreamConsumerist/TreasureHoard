-- Hand-written migration (drizzle-kit generate --custom): the "Owed to me"
-- asset account. Its sub-accounts are the people who owe you money (a
-- roommate's share of a bill, a loan to a friend). The Dashboard's
-- "Owed to you" card lists them. Never edit this file once it has been deployed.
--
-- Same rules as collection_accounts, since production already holds data:
--   * an account already carrying the system_key is left alone (re-runnable);
--   * a top-level asset account already named "Owed to me" is ADOPTED;
--   * if that name is taken by an account of another type, the new account
--     is created as "Owed to me (Receivables)" so the migration never fails.

DO $$
DECLARE
  aid integer;
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE system_key = 'receivables') THEN
    RETURN;
  END IF;

  SELECT id INTO aid FROM accounts
    WHERE name = 'Owed to me' AND parent_id IS NULL AND type = 'asset';

  IF aid IS NOT NULL THEN
    UPDATE accounts SET system_key = 'receivables', archived = false WHERE id = aid;
  ELSIF EXISTS (SELECT 1 FROM accounts WHERE name = 'Owed to me' AND parent_id IS NULL) THEN
    INSERT INTO accounts (name, type, system_key)
      VALUES ('Owed to me (Receivables)', 'asset', 'receivables');
  ELSE
    INSERT INTO accounts (name, type, system_key)
      VALUES ('Owed to me', 'asset', 'receivables');
  END IF;
END
$$;
