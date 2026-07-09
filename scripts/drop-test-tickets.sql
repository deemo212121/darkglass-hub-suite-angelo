-- ============================================================================
-- Drop ALL tickets (and dependents) we created during recent ServicePower sync
-- testing.
--
-- This is COMPANY-SCOPED. It deletes only rows owned by the company you pin in
-- the WITH clause below. The dependent tables are cleaned up explicitly in the
-- right order so foreign keys are satisfied even on schemas without ON DELETE
-- CASCADE on every relation.
--
-- HOW TO USE
--   1. Open Supabase → SQL Editor.
--   2. Replace the company_id literal below with YOUR company UUID. You can
--      grab it from the `companies` table or from any existing ticket row:
--        select id, name from companies;
--   3. (Optional) tighten the scope by uncommenting the `and ticket_source ...`
--      filter so only ServicePower-sourced tickets get dropped (recommended if
--      you also have hand-created portal tickets you want to keep).
--   4. Run inside a transaction so you can ROLLBACK if the row counts look off.
-- ============================================================================

begin;

with target as (
  select 'PUT-YOUR-COMPANY-UUID-HERE'::uuid as company_id
),

-- The set of ticket ids we're going to nuke. Add filters here if you want to
-- keep some (e.g. only ServicePower-imported, only created today, etc.).
victims as (
  select t.id
  from tickets t, target
  where t.company_id = target.company_id
    -- Uncomment to limit to ServicePower-synced tickets only:
    -- and t.ticket_source ilike '%servicepower%'
    -- Uncomment to limit to a date range (UTC):
    -- and t.created_at >= '2026-06-22'
    -- and t.created_at <  '2026-06-24'
)

-- Order matters: children first, parent last.
, del_parts as (
    delete from parts where ticket_id in (select id from victims) returning 1
)
, del_ticket_billing as (
    delete from ticket_billing where ticket_id in (select id from victims) returning 1
)
, del_ticket_comments as (
    delete from ticket_comments where ticket_id in (select id from victims) returning 1
)
, del_ticket_alerts as (
    delete from ticket_alerts where ticket_id in (select id from victims) returning 1
)
, del_ticket_audit_log as (
    delete from ticket_audit_log where ticket_id in (select id from victims) returning 1
)
, del_ticket_visit_log as (
    delete from ticket_visit_log where ticket_id in (select id from victims) returning 1
)
, del_tickets as (
    delete from tickets where id in (select id from victims) returning 1
)
select
  (select count(*) from del_tickets)            as tickets_deleted,
  (select count(*) from del_parts)              as parts_deleted,
  (select count(*) from del_ticket_billing)     as billing_deleted,
  (select count(*) from del_ticket_comments)    as comments_deleted,
  (select count(*) from del_ticket_alerts)      as alerts_deleted,
  (select count(*) from del_ticket_audit_log)   as audit_deleted,
  (select count(*) from del_ticket_visit_log)   as visits_deleted;

-- Also clear the "synced from portal" pointers so they re-import next sync.
update portal_service_requests
set er_ticket_id = null,
    er_ticket_no = null,
    sync_status  = null,
    last_synced_at = null
where company_id = (select company_id from target)
  and er_ticket_id is not null;

-- 🚦 INSPECT THE COUNTS ABOVE. If they look correct, run `commit;`.
-- If anything looks off, run `rollback;` and tweak the victims CTE.
-- commit;
-- rollback;
