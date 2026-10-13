-- =====================================================================
-- 0367 — Bulk ticket import: update existing tickets as a SYSTEM change.
--
-- Tickets → Create New Ticket → Import Bulk Tickets now also updates
-- tickets that already exist (status, schedule date, and the technician
-- when the ticket has none — or always, if the importer ticks "Also update
-- technician assignments"). Those edits come from the uploaded file, not
-- from the person who clicked Import, so they must not be credited to them:
-- otherwise every imported status change lands in ticket_audit_log under
-- the importer, inflating their Daily Report action counts and hiding the
-- tickets from the CSR To Do List as "touched today".
--
-- 1. log_ticket_change() (the trg_ticket_audit trigger, migration 0001)
--    records changed_by / status_changed_by as NULL — "system", same as
--    the ServicePower/NSA syncs — while the transaction-local setting
--    app.system_change = 'on'. Otherwise unchanged.
-- 2. import_ticket_updates(p_updates jsonb) applies a batch of updates
--    with that setting on. SECURITY INVOKER: the caller's own RLS still
--    decides which tickets they can update (their company only).
--    p_updates = [{ "ticket_no": "...", "status"?: "...",
--                   "schedule_date"?: "YYYY-MM-DD", "technician"?: "..." }]
--    Only keys present are changed. A technician or schedule change also
--    clears the on-site check-in (same as updateTicketAssignment, 0202).
--    Returns the ticket numbers actually updated.
--
-- Run once in the Supabase SQL Editor, after 0366.
-- =====================================================================

create or replace function log_ticket_change()
returns trigger language plpgsql as $$
declare
  v_actor uuid := case when coalesce(current_setting('app.system_change', true), '') = 'on' then null else auth_profile_id() end;
begin
  if new.status is distinct from old.status then
    insert into ticket_audit_log(company_id, ticket_id, action, field, before_value, after_value, changed_by)
    values (new.company_id, new.id, 'status_change', 'status', old.status, new.status, v_actor);
    new.status_changed_by := v_actor;
    new.status_changed_at := now();
  end if;
  if new.assigned_tech_id is distinct from old.assigned_tech_id then
    insert into ticket_audit_log(company_id, ticket_id, action, field, before_value, after_value, changed_by)
    values (new.company_id, new.id, 'reassign', 'assigned_tech_id',
            old.assigned_tech_id::text, new.assigned_tech_id::text, v_actor);
  end if;
  if new.schedule_date is distinct from old.schedule_date then
    insert into ticket_audit_log(company_id, ticket_id, action, field, before_value, after_value, changed_by)
    values (new.company_id, new.id, 'reschedule', 'schedule_date',
            old.schedule_date::text, new.schedule_date::text, v_actor);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function import_ticket_updates(p_updates jsonb)
returns text[] language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  v_updated text[] := '{}';
  v_no text;
  v_reassign boolean;
begin
  perform set_config('app.system_change', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) loop
    v_no := r->>'ticket_no';
    continue when v_no is null or v_no = '';
    v_reassign := (r ? 'technician') or (r ? 'schedule_date');
    update tickets t set
      status = case when r ? 'status' then r->>'status' else t.status end,
      schedule_date = case when r ? 'schedule_date' then (r->>'schedule_date')::date else t.schedule_date end,
      technician = case when r ? 'technician' then r->>'technician' else t.technician end,
      onsite_arrived_at = case when v_reassign then null else t.onsite_arrived_at end,
      onsite_done_at = case when v_reassign then null else t.onsite_done_at end
    where t.ticket_no = v_no;
    if found then v_updated := v_updated || v_no; end if;
  end loop;
  perform set_config('app.system_change', '', true);
  return v_updated;
end;
$$;

grant execute on function import_ticket_updates(jsonb) to authenticated;
