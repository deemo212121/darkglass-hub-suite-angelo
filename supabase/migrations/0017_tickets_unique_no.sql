-- =====================================================================
-- 0017 — Unique ticket number per company
-- Prevents duplicate ticket rows from being created when the same call is
-- synced from ServicePower (or any other source) more than once at the same
-- time. The upsert-from-SP path already looks up by ticket_no and updates
-- when found, but without a unique index a race between two concurrent
-- syncs could insert twice. This index makes that physically impossible —
-- the second insert fails with a constraint error and the upsert falls
-- through to the update branch.
--
-- The unique index is partial so it ignores any historical NULL/blank
-- ticket_no rows (none expected, but safe).
--
-- BEFORE applying this migration you should clean up any existing
-- duplicates. Run this query first to find them; if it returns rows,
-- delete the surplus before adding the index.
--
--   select company_id, ticket_no, count(*)
--     from tickets
--    where ticket_no is not null and ticket_no <> ''
--    group by 1, 2
--   having count(*) > 1;
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create unique index if not exists idx_tickets_company_ticket_no
  on tickets (company_id, ticket_no)
  where ticket_no is not null and ticket_no <> '';
