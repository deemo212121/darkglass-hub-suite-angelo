-- =====================================================================
-- 0171 — Add 'PARTS' as a third connectable Gmail slot on
-- hr_gmail_connections, alongside 'US'/'PH' Payroll.
--
-- The ticket page's Part Transaction "Send" (drop-ship request) used to
-- reuse whichever Payroll US/PH account was already connected, resolved
-- from the ticket's branch — meaning a distributor email would go out
-- from a Payroll mailbox, wrong sender identity for that purpose. This
-- gives Parts/Drop-Ship its own independent connection instead: an Admin
-- can connect the SAME Gmail account to both slots if they want (nothing
-- stops re-authenticating one account twice), or a genuinely different
-- one — either way it's no longer forced to share Payroll's.
--
-- get_gmail_connection_status()/disconnect_gmail() (0113) already take a
-- plain p_region text with no hardcoded US/PH logic inside them — only
-- the table's own CHECK constraint restricted the allowed values, so
-- widening it is the only schema change needed. 'PARTS' isn't a real
-- geographic region — it's reusing this table/column as a general
-- "connection slot key", same idiom, just a third slot instead of two.
--
-- Run once in the Supabase SQL Editor, after 0170.
-- =====================================================================

alter table hr_gmail_connections drop constraint if exists hr_gmail_connections_region_check;
alter table hr_gmail_connections add constraint hr_gmail_connections_region_check
  check (region in ('US', 'PH', 'PARTS'));
