-- =====================================================================
-- 0215 — Technician-initiated ticket reschedules
--
-- A technician can now mark one of their own assigned tickets as
-- "Reschedule" from the mobile On-Site Check-In card, typing a reason
-- (e.g. "wife is sick, can't make it today"). This does NOT touch the real
-- ticket's own schedule_date/status — it's a same-day, mileage-side-effect
-- -only flag: syncMileageFromTickets (mileage.ts) excludes a rescheduled
-- ticket from that day's route computation entirely (not just hides its
-- row), and the reason surfaces to Accounting in Ticket Attendance's
-- Diagnosis column and the Accounting Dashboard's new "Reason" tab.
--
-- One row per (ticket, work_date) — a ticket rescheduled today and, on some
-- later real day, actually scheduled and worked, gets its own separate row
-- for that day if rescheduled again; the unique constraint lets a second
-- Reschedule tap on the same day update the existing reason instead of
-- creating a duplicate.
--
-- Run once in the Supabase SQL Editor, after 0214.
-- =====================================================================

create table if not exists ticket_reschedules (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null references tickets(id) on delete cascade,
  ticket_no       text not null,
  work_date       date not null,
  reason          text not null,
  profile_id      uuid not null references profiles(id) on delete cascade,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (ticket_id, work_date)
);

create index if not exists idx_ticket_reschedules_company on ticket_reschedules(company_id);
create index if not exists idx_ticket_reschedules_ticket on ticket_reschedules(ticket_id, work_date);

alter table ticket_reschedules enable row level security;
alter table ticket_reschedules force row level security;

-- Select: company-wide — a reschedule reason is operational scheduling
-- info (same visibility class as ticket comments/diagnosis text already
-- broadly readable), not restricted like payroll/HR data.
drop policy if exists ticket_reschedules_select on ticket_reschedules;
create policy ticket_reschedules_select on ticket_reschedules
  for select using (company_id = auth_company_id());

-- Insert: only the technician's own row. No strict "ticket assigned to
-- this profile" check in SQL — tickets.technician is a free-text name, not
-- a profile_id FK (same trust model the existing on-site check-in comment
-- writes already use; the app UI only ever shows a tech their own tickets).
drop policy if exists ticket_reschedules_insert on ticket_reschedules;
create policy ticket_reschedules_insert on ticket_reschedules
  for insert with check (
    profile_id = auth_profile_id()
    and company_id = auth_company_id()
  );

-- Update: the technician can correct their own reason text; SuperAdmin/
-- Finance can also edit any row while reviewing.
drop policy if exists ticket_reschedules_update on ticket_reschedules;
create policy ticket_reschedules_update on ticket_reschedules
  for update using (
    company_id = auth_company_id()
    and (profile_id = auth_profile_id() or is_company_superadmin() or is_finance())
  )
  with check (
    company_id = auth_company_id()
    and (profile_id = auth_profile_id() or is_company_superadmin() or is_finance())
  );

-- Delete: SuperAdmin/Finance only — a technician can fix a typo (update)
-- but shouldn't be able to erase the audit trail outright.
drop policy if exists ticket_reschedules_delete on ticket_reschedules;
create policy ticket_reschedules_delete on ticket_reschedules
  for delete using (
    company_id = auth_company_id()
    and (is_company_superadmin() or is_finance())
  );

-- Auto-stamp company_id from the caller's own JWT, same shared trigger
-- every tenant table uses (see 0208_technician_checkout_proposals.sql).
drop trigger if exists trg_ticket_reschedules_company on ticket_reschedules;
create trigger trg_ticket_reschedules_company
  before insert on ticket_reschedules
  for each row execute function set_company_id();
