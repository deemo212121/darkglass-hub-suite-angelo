-- =====================================================================
-- 0370 — (1) Punch times come from the database clock, not the device.
--        (2) Record who last edited a ticket's notes (CSR To Do List).
--
-- (1) A person's OWN Time In / Meal In / Meal Out / Time Out used to be
--     saved with whatever time the app sent. The app already uses the
--     server's clock, but anyone could send their own request (browser dev
--     tools / a script) with a made-up time. Now, for a self-punch by a
--     regular employee:
--       - a NEW punch (empty -> filled) is stamped with the database's
--         current time in the person's Master List time zone
--         (profiles.schedule_timezone: EST -> America/New_York, anything
--         else -> America/Chicago — PH staff follow Central), and must be
--         for TODAY in that zone;
--       - changing an existing punch to a different time is refused — that
--         is what a Time Correction request is for;
--       - clearing the most recent punch (self-undo) still works.
--     Untouched: punches made for someone else (a manager clock-in), HR /
--     Admin / Accounting / Super Admin editing timecards (incl. their own),
--     approved Time Corrections (applied by the approver), and server jobs
--     (forced / automatic clock-outs run without a signed-in user).
--     Applies to timecard_entries and trainee_timecard_entries.
--
-- (2) tickets.notes_touched_by / notes_touched_at — stamped when a signed-in
--     person changes internal_note or problem_description. Those edits
--     aren't in ticket_audit_log (adding them there would inflate the Daily
--     Report's action counts), so the CSR To Do List couldn't tell a CSR had
--     worked a ticket by only updating its notes.
--
-- Run once in the Supabase SQL Editor, after 0369.
-- =====================================================================

-- ---- (1) server-stamped punches -------------------------------------------
create or replace function stamp_self_punch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
  v_tz text;
  v_now timestamp;
  v_time text;
  c text;
  v_old text;
  v_new text;
begin
  -- Not a signed-in person (server job), someone else's timecard, or a role
  -- that's allowed to edit timecards: leave the row exactly as sent.
  if v_me is null or new.profile_id is distinct from v_me then
    return new;
  end if;
  if is_admin() or is_company_superadmin() or is_superadmin() or is_hr() or is_finance() then
    return new;
  end if;

  select case when upper(trim(coalesce(schedule_timezone, ''))) = 'EST' then 'America/New_York' else 'America/Chicago' end
    into v_tz from profiles where id = new.profile_id;
  v_tz := coalesce(v_tz, 'America/Chicago');
  v_now := now() at time zone v_tz;
  v_time := to_char(v_now, 'HH24:MI:SS');

  foreach c in array array['check_in', 'meal_start', 'meal_end', 'check_out'] loop
    execute format('select ($1).%I::text', c) using new into v_new;
    if tg_op = 'UPDATE' then
      execute format('select ($1).%I::text', c) using old into v_old;
    else
      v_old := null;
    end if;

    if v_new is null or v_new is not distinct from v_old then
      continue; -- cleared (self-undo) or unchanged
    end if;

    if v_old is null then
      -- a new punch
      if new.work_date <> v_now::date then
        raise exception 'Punches can only be made for today (%). Use a Time Correction request for another day.', v_now::date
          using errcode = 'P0001';
      end if;
      new := jsonb_populate_record(new, jsonb_build_object(c, v_time));
    else
      raise exception 'A punch can''t be changed here — send a Time Correction request.'
        using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_stamp_self_punch on timecard_entries;
create trigger trg_stamp_self_punch
  before insert or update on timecard_entries
  for each row execute function stamp_self_punch();

drop trigger if exists trg_stamp_self_punch on trainee_timecard_entries;
create trigger trg_stamp_self_punch
  before insert or update on trainee_timecard_entries
  for each row execute function stamp_self_punch();

-- ---- (2) ticket note touches ------------------------------------------------
alter table tickets add column if not exists notes_touched_by uuid references profiles(id) on delete set null;
alter table tickets add column if not exists notes_touched_at timestamptz;
create index if not exists idx_tickets_notes_touched_at on tickets (notes_touched_at);

-- Same as 0367's version (system changes record NULL), plus the notes stamp.
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
  if v_actor is not null
     and (new.internal_note is distinct from old.internal_note or new.problem_description is distinct from old.problem_description) then
    new.notes_touched_by := v_actor;
    new.notes_touched_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
