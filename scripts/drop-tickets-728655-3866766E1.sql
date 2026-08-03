-- ============================================================================
-- Drop two specific ServicePower tickets (and their dependents):
--   • 728655
--   • 3866766E1
-- Scoped to company b86acc43-08df-4ef3-aae0-1653cb5a1fcd (COMP001).
-- Run inside Supabase SQL Editor. Wrapped in a transaction so you can roll
-- back if the row counts don't look right.
-- ============================================================================

begin;

-- 1) Find the ticket ids first so we can drop dependents in the right order.
create temporary table _victims on commit drop as
select t.id, t.ticket_no
from tickets t
where t.company_id = 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd'::uuid
  and t.ticket_no in ('728655', '3866766E1');

-- 2) Show what we matched (must show 2 rows).
select * from _victims;

-- 3) Delete dependent rows. Children first, parent last.
delete from parts             where ticket_id in (select id from _victims);
delete from ticket_billing    where ticket_id in (select id from _victims);
delete from ticket_comments   where ticket_id in (select id from _victims);
delete from ticket_alerts     where ticket_id in (select id from _victims);
delete from ticket_audit_log  where ticket_id in (select id from _victims);
delete from ticket_visit_log  where ticket_id in (select id from _victims);
delete from tickets           where id        in (select id from _victims);

-- 4) Clear portal-import pointers so the same call numbers can sync again.
update portal_service_requests
set er_ticket_no = null
where company_id = 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd'::uuid
  and er_ticket_no in ('728655', '3866766E1');

-- 🚦 Inspect the SELECT result above. If it shows the 2 expected tickets,
-- run `commit;`. If anything looks off, run `rollback;`.
-- commit;
-- rollback;
