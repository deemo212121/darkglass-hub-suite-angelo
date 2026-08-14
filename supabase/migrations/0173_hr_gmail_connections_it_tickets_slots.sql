-- =====================================================================
-- 0173 — Add 3 connectable Gmail slots for IT Tickets ('IT_1'/'IT_2'/
-- 'IT_3'), alongside 'US'/'PH' Payroll and 'PARTS'.
--
-- Unlike every previous slot (each resolved to exactly one fixed
-- account per send), IT Tickets' "Send" lets the caller pick WHICH of
-- up to 3 connected accounts to send from — so this is 3 independent
-- slots rather than one, letting IT connect e.g. a support@ mailbox, a
-- personal one, and a shared team one, and choose per-email which
-- identity to send as.
--
-- get_gmail_connection_status()/disconnect_gmail() (0113) already take
-- a plain p_region text with no hardcoded region logic inside them —
-- only the table's own CHECK constraint restricted the allowed values,
-- so widening it is the only schema change needed, same idiom as 0168.
--
-- Run once in the Supabase SQL Editor, after 0172.
-- =====================================================================

alter table hr_gmail_connections drop constraint if exists hr_gmail_connections_region_check;
alter table hr_gmail_connections add constraint hr_gmail_connections_region_check
  check (region in ('US', 'PH', 'PARTS', 'IT_1', 'IT_2', 'IT_3'));
