-- =====================================================================
-- 0277 — CSR Daily Report: the Mistake Log at the bottom of the page
-- (CSRTeamDailyReport.tsx) — a running, company-wide list of incidents
-- (Name/Reason/Action Taken), NOT scoped to a single report date like the
-- rest of the page. Deliberately a plain flat log with no approval
-- workflow (unlike employee_conduct_notes/csrAgentNotes.ts's
-- pending -> manager_approved -> approved pipeline) — this is meant to be
-- typed in and corrected freely, matching the original spreadsheet.
-- "Mistake #" (the Nth mistake for that person) is computed client-side
-- from how many rows that person already has, not stored — same reasoning
-- as the main grid's computed Month/summary-panel totals.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as csr_daily_report_entries (0275); reuses that
-- migration's csr_daily_report_extras_stamp() trigger function (0276).
-- Run once in the Supabase SQL Editor, after 0276.
-- =====================================================================

create table if not exists csr_mistake_log_entries (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  profile_id     uuid not null references profiles(id) on delete cascade,
  occurred_date  date,
  reason         text,
  action_taken   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_csr_mistake_log_entries_company on csr_mistake_log_entries(company_id);
create index if not exists idx_csr_mistake_log_entries_profile on csr_mistake_log_entries(profile_id);
create index if not exists idx_csr_mistake_log_entries_date on csr_mistake_log_entries(occurred_date);

drop trigger if exists trg_csr_mistake_log_entries_stamp on csr_mistake_log_entries;
create trigger trg_csr_mistake_log_entries_stamp before insert or update on csr_mistake_log_entries
  for each row execute function csr_daily_report_extras_stamp();

-- ---------- RLS: company-scoped, same pattern as csr_teams (0031) ----------
alter table csr_mistake_log_entries enable row level security;
alter table csr_mistake_log_entries force row level security;

drop policy if exists csr_mistake_log_entries_select on csr_mistake_log_entries;
create policy csr_mistake_log_entries_select on csr_mistake_log_entries
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists csr_mistake_log_entries_insert on csr_mistake_log_entries;
create policy csr_mistake_log_entries_insert on csr_mistake_log_entries
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists csr_mistake_log_entries_update on csr_mistake_log_entries;
create policy csr_mistake_log_entries_update on csr_mistake_log_entries
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists csr_mistake_log_entries_delete on csr_mistake_log_entries;
create policy csr_mistake_log_entries_delete on csr_mistake_log_entries
  for delete using (company_id = auth_company_id() or is_superadmin());
