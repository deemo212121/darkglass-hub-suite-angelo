-- =====================================================================
-- 0028 — Timecard corrections (Attendance Monitoring "Corrections" tab)
--
-- An employee's punch was wrong (system error, forgot to clock out, etc.)
-- and a manager needs to review + approve a corrected check-in/check-out
-- before it's applied to the real timecard_entries row.
--
-- timecard_correction_history is an append-only audit trail, auto-populated
-- by a trigger (mirrors log_ticket_change() in 0001_init.sql) — the client
-- never inserts into it directly.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists timecard_corrections (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  profile_id            uuid not null references profiles(id) on delete cascade,
  work_date             date not null,
  original_check_in     text,
  original_check_out    text,
  corrected_check_in    text,
  corrected_check_out   text,
  reason                text,
  status                text not null default 'pending'
                        check (status in ('pending','approved','rejected')),
  requested_by          uuid references profiles(id),
  reviewed_by           uuid references profiles(id),
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists idx_timecard_corrections_profile
  on timecard_corrections(profile_id, work_date);
create index if not exists idx_timecard_corrections_status
  on timecard_corrections(company_id, status);

create table if not exists timecard_correction_history (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  correction_id   uuid not null references timecard_corrections(id) on delete cascade,
  action          text not null,
  changed_by      uuid references profiles(id),
  previous_status text,
  new_status      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_timecard_correction_history_correction
  on timecard_correction_history(correction_id, created_at desc);

-- ---------- Auto-stamp company_id (reuses set_company_id() from 0001_init.sql) ----------
drop trigger if exists trg_timecard_corrections_company on timecard_corrections;
create trigger trg_timecard_corrections_company
  before insert on timecard_corrections
  for each row execute function set_company_id();

drop trigger if exists trg_timecard_correction_history_company on timecard_correction_history;
create trigger trg_timecard_correction_history_company
  before insert on timecard_correction_history
  for each row execute function set_company_id();

-- ---------- Auto-log submissions + status changes ----------
create or replace function log_timecard_correction_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into timecard_correction_history(company_id, correction_id, action, changed_by, previous_status, new_status)
    values (new.company_id, new.id, 'submitted', coalesce(new.requested_by, auth_profile_id()), null, new.status);
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into timecard_correction_history(company_id, correction_id, action, changed_by, previous_status, new_status)
    values (new.company_id, new.id, new.status, auth_profile_id(), old.status, new.status);
    new.reviewed_by := auth_profile_id();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_timecard_correction_log_insert on timecard_corrections;
create trigger trg_timecard_correction_log_insert
  after insert on timecard_corrections
  for each row execute function log_timecard_correction_change();

drop trigger if exists trg_timecard_correction_log_update on timecard_corrections;
create trigger trg_timecard_correction_log_update
  before update on timecard_corrections
  for each row execute function log_timecard_correction_change();

-- ---------- RLS: company-scoped, matches the rest of the platform ----------
alter table timecard_corrections enable row level security;
alter table timecard_corrections force row level security;

drop policy if exists timecard_corrections_select on timecard_corrections;
create policy timecard_corrections_select on timecard_corrections
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists timecard_corrections_insert on timecard_corrections;
create policy timecard_corrections_insert on timecard_corrections
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists timecard_corrections_update on timecard_corrections;
create policy timecard_corrections_update on timecard_corrections
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists timecard_corrections_delete on timecard_corrections;
create policy timecard_corrections_delete on timecard_corrections
  for delete using (company_id = auth_company_id() or is_superadmin());

alter table timecard_correction_history enable row level security;
alter table timecard_correction_history force row level security;

drop policy if exists timecard_correction_history_select on timecard_correction_history;
create policy timecard_correction_history_select on timecard_correction_history
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists timecard_correction_history_insert on timecard_correction_history;
create policy timecard_correction_history_insert on timecard_correction_history
  for insert with check (company_id = auth_company_id() or is_superadmin());

-- No update/delete policy on history — it's an immutable audit trail.
