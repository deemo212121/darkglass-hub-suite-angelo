-- =====================================================================
-- 0216 — Trainee pending timecard entries
--
-- A trainee (profiles.employment_type = 'trainee', migration 0152) punches
-- in/out on the exact same screens every other employee uses (TimeClockMenu,
-- My Timecard, mobile Home's ClockCard) — but for a trainee those punches
-- land here instead of directly on timecard_entries. Nothing counts as
-- their "actual timecard" until their direct manager (resolved via
-- resolveTeamLeadOrManager, same helper every other approval flow in this
-- app already uses) approves the day from Attendance Monitoring's new
-- "Trainee Attendance" tab — at which point it's copied onto the real
-- timecard_entries row via the existing saveEntry().
--
-- One row per trainee per day, mirroring timecard_entries' own shape (not
-- just one field like technician_checkout_proposals) since a trainee's
-- whole day is pending, not just one punch.
--
-- RLS here is deliberately permissive (company-scoped only), same
-- convention timecard_corrections already uses — the real "who can
-- approve THIS row" logic (direct manager, or Admin/HR/SuperAdmin as an
-- override) lives in the app layer (canApproveTraineeDay in
-- traineeTimecards.ts), not in SQL.
--
-- Run once in the Supabase SQL Editor, after 0215.
-- =====================================================================

create table if not exists trainee_timecard_entries (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  work_date       date not null,
  check_in        text,
  check_out       text,
  meal_start      text,
  meal_end        text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Resolved once (via resolveTeamLeadOrManager) the first time the trainee
  -- punches for this day — recorded here rather than re-resolved live on
  -- every read, same reason timecard_corrections records managerId at
  -- submission time: the trainee's manager_name could change later without
  -- retroactively changing who was actually responsible for reviewing this
  -- specific day.
  manager_id      uuid references profiles(id),
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  reject_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (profile_id, work_date)
);

create index if not exists idx_trainee_timecard_entries_company on trainee_timecard_entries(company_id);
create index if not exists idx_trainee_timecard_entries_status on trainee_timecard_entries(company_id, status);

alter table trainee_timecard_entries enable row level security;
alter table trainee_timecard_entries force row level security;

create policy trainee_timecard_entries_select on trainee_timecard_entries
  for select using (company_id = auth_company_id() or is_superadmin());
create policy trainee_timecard_entries_insert on trainee_timecard_entries
  for insert with check (company_id = auth_company_id() or is_superadmin());
create policy trainee_timecard_entries_update on trainee_timecard_entries
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
create policy trainee_timecard_entries_delete on trainee_timecard_entries
  for delete using (company_id = auth_company_id() or is_superadmin());

-- Auto-stamp company_id from the caller's own JWT, same shared trigger
-- every tenant table uses.
drop trigger if exists trg_trainee_timecard_entries_company on trainee_timecard_entries;
create trigger trg_trainee_timecard_entries_company
  before insert on trainee_timecard_entries
  for each row execute function set_company_id();
