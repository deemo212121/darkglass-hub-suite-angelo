-- =====================================================================
-- 0408 — ER history backfill: marker, Cx Preferred Date, fill-blanks import.
-- (Numbered 0407 in janeyyy16's repo — renumbered here past this repo's own
-- 0407_hr_trainee_decisions.)
--
-- 1. tickets.er_backfill — true on tickets created by Import Bulk Tickets
--    in "ER history" mode. Payroll (tech repair counts, second techs,
--    mileage), Ticket Attendance and the default ticket list leave these
--    out, so six months of old tickets can come in without changing pay
--    or past reports, and a bad batch can be found and removed by itself.
--    Visits entered through the ticket page's "Past record from ER" box
--    carry the same flag (visits.er_backfill), so they never count as a
--    repair in tech pay.
-- 2. tickets.cx_preferred_date — the date the customer asked for. Until
--    now the ticket page only mirrored the schedule date and the import
--    kept a yes / no (customer_pref, which stays as it is).
-- 3. import_ticket_updates (0367) also takes "fill": { column: value }
--    and writes each value ONLY where the ticket's column is blank — the
--    import's "fill blanks" rule for tickets already in AHS. Still a
--    system change (not credited to the importer) and still SECURITY
--    INVOKER (the caller's RLS decides which tickets they can touch).
--    Only the columns listed below can be filled.
--
-- Run once in the Supabase SQL Editor, after 0407.
-- =====================================================================

alter table tickets add column if not exists er_backfill boolean not null default false;
alter table tickets add column if not exists cx_preferred_date date;
create index if not exists tickets_er_backfill_idx on tickets (company_id) where er_backfill;

alter table visits add column if not exists er_backfill boolean not null default false;

create or replace function import_ticket_updates(p_updates jsonb)
returns text[] language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  f jsonb;
  v_updated text[] := '{}';
  v_no text;
  v_reassign boolean;
begin
  perform set_config('app.system_change', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) loop
    v_no := r->>'ticket_no';
    continue when v_no is null or v_no = '';
    f := coalesce(r->'fill', '{}'::jsonb);
    v_reassign := (r ? 'technician') or (r ? 'schedule_date');
    update tickets t set
      status = case when r ? 'status' then r->>'status' else t.status end,
      schedule_date = case when r ? 'schedule_date' then (r->>'schedule_date')::date else t.schedule_date end,
      technician = case when r ? 'technician' then r->>'technician' else t.technician end,
      onsite_arrived_at = case when v_reassign then null else t.onsite_arrived_at end,
      onsite_done_at = case when v_reassign then null else t.onsite_done_at end,
      -- fill blanks only
      model = coalesce(nullif(t.model, ''), f->>'model'),
      model_version = coalesce(nullif(t.model_version, ''), f->>'model_version'),
      serial = coalesce(nullif(t.serial, ''), f->>'serial'),
      product_type = coalesce(nullif(t.product_type, ''), f->>'product_type'),
      warranty = coalesce(nullif(t.warranty, ''), f->>'warranty'),
      manufacturer = coalesce(nullif(t.manufacturer, ''), f->>'manufacturer'),
      account = coalesce(nullif(t.account, ''), f->>'account'),
      account_no = coalesce(nullif(t.account_no, ''), f->>'account_no'),
      location = coalesce(nullif(t.location, ''), f->>'location'),
      problem_description = coalesce(nullif(t.problem_description, ''), f->>'problem_description'),
      internal_note = coalesce(nullif(t.internal_note, ''), f->>'internal_note'),
      call_received_date = coalesce(t.call_received_date, (f->>'call_received_date')::date),
      cx_preferred_date = coalesce(t.cx_preferred_date, (f->>'cx_preferred_date')::date)
    where t.ticket_no = v_no;
    if found then v_updated := v_updated || v_no; end if;
  end loop;
  perform set_config('app.system_change', '', true);
  return v_updated;
end;
$$;

grant execute on function import_ticket_updates(jsonb) to authenticated;
