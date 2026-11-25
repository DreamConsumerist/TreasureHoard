-- Hand-written migration (drizzle-kit generate --custom): the accounts the
-- collection books into. Never edit this file once it has been deployed.
--
--   Assets → Collection → Cards / Sealed / Games / Hardware
--   Income → Realized Gains on Collection
--
-- Production already holds data, so this can't assume the names are free:
--   * an account already carrying the system_key is left alone (re-runnable);
--   * a same-named account of the same type in the same place is ADOPTED
--     (it gets the system_key and is unarchived) instead of duplicated;
--   * if the name is taken by an account of a different type, the new account
--     is created as "<name> (Collection)" so the migration never fails.

DO $$
DECLARE
  r record;
  pid integer;
  aid integer;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'Collection',                   'asset',  NULL,         'collection'),
      (2, 'Cards',                        'asset',  'collection', 'collection_card'),
      (3, 'Sealed',                       'asset',  'collection', 'collection_sealed'),
      (4, 'Games',                        'asset',  'collection', 'collection_game'),
      (5, 'Hardware',                     'asset',  'collection', 'collection_hardware'),
      (6, 'Realized Gains on Collection', 'income', NULL,         'realized_gains')
    ) AS v(ord, name, type, parent_key, key)
    ORDER BY ord
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM accounts WHERE system_key = r.key);

    pid := NULL;
    IF r.parent_key IS NOT NULL THEN
      SELECT id INTO pid FROM accounts WHERE system_key = r.parent_key;
    END IF;

    SELECT id INTO aid FROM accounts
      WHERE name = r.name
        AND parent_id IS NOT DISTINCT FROM pid
        AND type = r.type::account_type;

    IF aid IS NOT NULL THEN
      UPDATE accounts SET system_key = r.key, archived = false WHERE id = aid;
    ELSIF EXISTS (
      SELECT 1 FROM accounts WHERE name = r.name AND parent_id IS NOT DISTINCT FROM pid
    ) THEN
      INSERT INTO accounts (name, type, parent_id, system_key)
        VALUES (r.name || ' (Collection)', r.type::account_type, pid, r.key);
    ELSE
      INSERT INTO accounts (name, type, parent_id, system_key)
        VALUES (r.name, r.type::account_type, pid, r.key);
    END IF;
  END LOOP;
END
$$;
