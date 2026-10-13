-- =====================================================================
-- 0362 — Late clock-out check (technicians, primary or extra role).
--
-- After a technician clocks out, the Worker works out when they should
-- have clocked out: their last "Work Done" ticket that day + the drive
-- time from that customer's address to where they end the day + a
-- 10-minute extension. Where they end the day:
--   1. on a Flash Tech trip that day -> the branch address of the trip's
--      destination location,
--   2. otherwise their home address (profiles.employee_info),
--   3. otherwise their assigned branch's address.
-- If the actual Time Out is later than that, HR gets a notification.
--
-- One row per technician per day (also what keeps the job from checking
-- the same day twice). Written only by the Worker (service key); readable
-- by HR / Admin / Super Admin / Finance in the same company.
--
-- New table only — no existing data is changed.
-- Run once in the Supabase SQL Editor, after 0361.
-- =====================================================================

create table if not exists technician_clock_out_checks (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  profile_id         uuid not null references profiles(id) on delete cascade,
  work_date          date not null,
  status             text not null check (status in ('ok', 'late', 'skipped')),
  reason             text,
  last_ticket_no     text,
  last_done_at       timestamptz,
  destination_kind   text check (destination_kind in ('home', 'branch', 'flash_tech_branch')),
  destination_label  text,
  drive_minutes      integer,
  expected_out       text,   -- "HH:MM:SS", technician's local time
  actual_out         text,   -- "HH:MM:SS", technician's local time
  minutes_late       integer,
  hr_notified_at     timestamptz,
  created_at         timestamptz not null default now(),
  unique (profile_id, work_date)
);

create index if not exists idx_technician_clock_out_checks_company
  on technician_clock_out_checks(company_id, work_date desc);

alter table technician_clock_out_checks enable row level security;

drop policy if exists technician_clock_out_checks_select on technician_clock_out_checks;
create policy technician_clock_out_checks_select on technician_clock_out_checks
  for select using (
    company_id = auth_company_id()
    and exists (
      select 1 from profiles
      where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
        and (
          upper(role) in ('HR', 'ADMIN', 'SUPERADMIN', 'FINANCE')
          or exists (select 1 from unnest(coalesce(extra_roles, '{}')) r where upper(r) in ('HR', 'ADMIN', 'SUPERADMIN', 'FINANCE'))
        )
    )
  );
-- No insert/update/delete policies: only the Worker (service key) writes.
