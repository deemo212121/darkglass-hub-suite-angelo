-- =====================================================================
-- 0308 — CSR Reschedule Requests daily notes
--
-- The new "Reschedule Requests" tile on the CSR module home page
-- summarizes reschedule-mode Ticket Time Dispute submissions
-- (employee_requests.dispute_mode = 'reschedule', migration 0307) per
-- (work_date, technician): how many tickets that tech had that day, how
-- many were rescheduled, plus three CSR-editable cells — Phone DX,
-- Rerouted, and a free-text Notes column — since neither of those first
-- two has any other data source in the app yet (a CSR tallies them by
-- hand, same as the paper/spreadsheet worksheet this replaces). CSR can
-- only view/annotate here, never approve or sign — that stays on the
-- Ticket Time Dispute review flow itself.
--
-- One row per (company, work_date, technician) — editing an existing
-- day/tech's cells upserts onto the same row rather than creating a new
-- one. Same shared-trigger company-scoping pattern as ticket_reschedules
-- (0215).
--
-- Run once in the Supabase SQL Editor, after 0307.
-- =====================================================================

create table if not exists csr_reschedule_daily_notes (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references companies(id) on delete cascade,
  work_date     date not null,
  technician    text not null,
  area          text,
  phone_dx      integer not null default 0,
  rerouted      integer not null default 0,
  notes         text not null default '',
  updated_by    uuid references profiles(id),
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (company_id, work_date, technician)
);

create index if not exists idx_csr_reschedule_daily_notes_date on csr_reschedule_daily_notes(work_date);

alter table csr_reschedule_daily_notes enable row level security;
alter table csr_reschedule_daily_notes force row level security;

-- Select/insert/update: company-wide — this is internal CSR operational
-- annotation (same visibility/editability class as ticket comments), not
-- restricted like payroll/HR data. No delete policy — a wrong tally gets
-- corrected in place (update), not erased.
drop policy if exists csr_reschedule_daily_notes_select on csr_reschedule_daily_notes;
create policy csr_reschedule_daily_notes_select on csr_reschedule_daily_notes
  for select using (company_id = auth_company_id());

drop policy if exists csr_reschedule_daily_notes_insert on csr_reschedule_daily_notes;
create policy csr_reschedule_daily_notes_insert on csr_reschedule_daily_notes
  for insert with check (company_id = auth_company_id());

drop policy if exists csr_reschedule_daily_notes_update on csr_reschedule_daily_notes;
create policy csr_reschedule_daily_notes_update on csr_reschedule_daily_notes
  for update using (company_id = auth_company_id())
  with check (company_id = auth_company_id());

drop trigger if exists trg_csr_reschedule_daily_notes_company on csr_reschedule_daily_notes;
create trigger trg_csr_reschedule_daily_notes_company
  before insert on csr_reschedule_daily_notes
  for each row execute function set_company_id();
