-- =====================================================================
-- backfill-electrolux-ticket-source.sql
--
-- One-shot fix for tickets that were auto-tagged with a warranty admin's
-- name (e.g. ASSURANT SOLUTIONS) but whose ticket_no shows they're
-- really Electrolux direct-service calls. All Electrolux ticket numbers
-- start with "1007".
--
-- Run in the Supabase SQL Editor. Safe to re-run — it only touches rows
-- that still hold a stale non-Electrolux value.
--
-- Requires migration 0025_ticket_source_edited.sql to have been run
-- first (adds the source_edited_by_user flag).
--
-- What it does:
--   • For every ticket whose ticket_no starts with "1007":
--       - Sets ticket_source = 'ELECTROLUX'
--       - Sets account       = 'ELECTROLUX'         (keeps header chip aligned)
--       - Sets claim_company = 'ELECTROLUX'         (keeps claim views aligned)
--       - Sets source_edited_by_user = true         (SP re-sync won't clobber)
--     …but only when the current value is NOT already ELECTROLUX (case-
--     insensitive), so we don't touch rows that are already correct.
--
-- Preview first (recommended):
--   Run the SELECT block below, review the count / examples, then run
--   the UPDATE.
-- =====================================================================

-- PREVIEW: how many rows would change and what they look like today.
-- (Comment this out once you're happy with the count.)
select
  count(*)                                       as tickets_to_update,
  min(ticket_no)                                 as example_first,
  max(ticket_no)                                 as example_last
from tickets
where ticket_no like '1007%'
  and coalesce(upper(ticket_source), '') <> 'ELECTROLUX'
  and coalesce(source_edited_by_user, false) = false;

-- APPLY:
update tickets
set
  ticket_source          = 'ELECTROLUX',
  account                = 'ELECTROLUX',
  claim_company          = 'ELECTROLUX',
  source_edited_by_user  = true,
  updated_at             = now()
where ticket_no like '1007%'
  and (
    coalesce(upper(ticket_source), '') <> 'ELECTROLUX'
    or coalesce(source_edited_by_user, false) = false
  );

-- Verify.
select
  ticket_no,
  ticket_source,
  account,
  claim_company,
  source_edited_by_user
from tickets
where ticket_no like '1007%'
order by ticket_no
limit 25;
