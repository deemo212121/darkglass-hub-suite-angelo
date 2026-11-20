-- =====================================================================
-- 0471 — Timecard footprint + Undo reset. (Angelo's 0469, renumbered past
-- 0469_payroll_period_locks / 0470_payroll_period_notes_admin_delete.)
--
-- Until now a timecard day kept no history: a punch, an HR edit or a
-- "Reset day" changed / deleted the row and the old times were gone.
--
-- (1) timecard_entry_log — every change to a day on timecard_entries is
--     recorded: the row before and after, who did it (or "System" for the
--     automatic clock-outs) and when. A Reset keeps the whole day here.
--     The recording can NEVER block a punch: if it fails, the punch still
--     saves (the failure is only skipped).
--
-- (2) timecard_undo_reset(log id) — puts a reset day back exactly as it was
--     (Time In, Meal, Time Out, who clocked in / corrected …). HR / HR
--     Manager / Accounting (Payroll's employee detail) / Admin / Super Admin.
--     Refused if the day has punches again (edit those with the pencil instead).
--
-- (3) chain_enforce_clock_in (0332) — unchanged, except it lets an Undo
--     reset put back a day a manager clocked someone in on (that clock-in
--     was already allowed when it was made).
--
-- Who can read the footprint: HR, Admin, Accounting, Super Admin.
-- Nothing existing is changed or deleted. Days reset BEFORE this is run
-- can't be brought back (nothing was kept then).
--
-- Run once in the Supabase SQL Editor, after 0470. Safe to run again.
-- =====================================================================

create table if not exists timecard_entry_log (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  profile_id        uuid references profiles(id) on delete cascade,
  work_date         date not null,
  -- punched / edited = insert / update; reset = the day was deleted; restored = Undo reset
  action            text not null check (action in ('added', 'changed', 'reset', 'restored')),
  old_row           jsonb,
  new_row           jsonb,
  actor_profile_id  uuid references profiles(id) on delete set null,
  actor_name        text,
  created_at        timestamptz not null default now(),
  -- set on a 'reset' entry once it has been undone
  restored_at       timestamptz,
  restored_by_name  text
);
create index if not exists idx_timecard_entry_log_day on timecard_entry_log(company_id, profile_id, work_date, created_at desc);
create index if not exists idx_timecard_entry_log_resets on timecard_entry_log(company_id, work_date) where action = 'reset';

create or replace function timecard_entry_log_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
  v_action text;
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  begin
    if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
      return null; -- nothing really changed
    end if;
    v_action := case
      when tg_op = 'DELETE' then 'reset'
      when tg_op = 'INSERT' and current_setting('timecard.restoring', true) = 'on' then 'restored'
      when tg_op = 'INSERT' then 'added'
      else 'changed'
    end;
    insert into timecard_entry_log (company_id, profile_id, work_date, action, old_row, new_row, actor_profile_id, actor_name)
    values (
      coalesce(new.company_id, old.company_id),
      coalesce(new.profile_id, old.profile_id),
      coalesce(new.work_date, old.work_date),
      v_action, v_old, v_new, v_me,
      coalesce((select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = v_me), 'System')
    );
  exception when others then
    -- Never block a punch because the footprint couldn't be written.
    raise warning 'timecard_entry_log_write skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_timecard_entry_log on timecard_entries;
create trigger trg_timecard_entry_log
  after insert or update or delete on timecard_entries
  for each row execute function timecard_entry_log_write();

-- (3) 0332's function, word for word, plus the first "if" (Undo reset only).
create or replace function chain_enforce_clock_in()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  allowed boolean;
begin
  if current_setting('timecard.restoring', true) = 'on' then return new; end if;
  if me is null then return new; end if;
  if new.clocked_in_by is null or new.clocked_in_by = new.profile_id then return new; end if;
  if tg_op = 'UPDATE' and new.clocked_in_by is not distinct from old.clocked_in_by then return new; end if;

  -- Nobody may stamp a clock-in as someone else.
  if new.clocked_in_by <> me and not (is_superadmin() or is_company_superadmin()) then
    raise exception 'Approval chain: a clock-in can only be recorded under your own name.' using errcode = '42501';
  end if;

  allowed := chain_can_clock_in(me, new.profile_id);
  if allowed is null or allowed then return new; end if;
  raise exception 'Approval chain: you are not allowed to clock in this employee.' using errcode = '42501';
end;
$$;

create or replace function timecard_undo_reset(p_log_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_log timecard_entry_log;
  v_name text;
begin
  if not (is_hr() or is_admin() or is_finance() or is_company_superadmin() or is_superadmin()) then
    raise exception 'Only HR, Accounting, Admin or Super Admin can undo a reset.';
  end if;
  select * into v_log from timecard_entry_log where id = p_log_id and company_id = auth_company_id() for update;
  if not found or v_log.action <> 'reset' or v_log.old_row is null then
    raise exception 'That reset isn''t in the history.';
  end if;
  if v_log.restored_at is not null then
    raise exception 'That reset was already undone.';
  end if;
  if exists (select 1 from timecard_entries where profile_id = v_log.profile_id and work_date = v_log.work_date) then
    raise exception 'This day has punches again — change them with the pencil instead.';
  end if;

  perform set_config('timecard.restoring', 'on', true);
  insert into timecard_entries select * from jsonb_populate_record(null::timecard_entries, v_log.old_row);
  perform set_config('timecard.restoring', 'off', true);

  v_name := (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id());
  update timecard_entry_log set restored_at = now(), restored_by_name = v_name where id = p_log_id;
end;
$$;

revoke all on function timecard_entry_log_write() from public, anon, authenticated;
revoke all on function timecard_undo_reset(uuid) from public, anon;
grant execute on function timecard_undo_reset(uuid) to authenticated;

-- RLS: read by HR / Admin / Accounting / Super Admin; written only by the trigger and the function above.
revoke all on timecard_entry_log from anon;
revoke insert, update, delete on timecard_entry_log from authenticated;
grant select on timecard_entry_log to authenticated;
alter table timecard_entry_log enable row level security;

drop policy if exists timecard_entry_log_select on timecard_entry_log;
create policy timecard_entry_log_select on timecard_entry_log
  for select using (
    company_id = auth_company_id()
    and (is_hr() or is_admin() or is_finance() or is_company_superadmin() or is_superadmin())
  );

notify pgrst, 'reload schema';
