-- =====================================================================
-- 0318 — LTP Report's "CSR" and "Notes" columns
-- (src/components/CsrLtpReport.tsx) — one row per (branch, date): "csr" is
-- whoever's assigned to that branch/task that day (picked from a CSR
-- datalist or freely typed — not a foreign key, since it's meant to match
-- a plain spreadsheet cell, not enforce that every name is a real profile),
-- "note" is a freeform note. Both typed in by whichever CSR is reviewing
-- that branch's row that day. Same shared, page-level-gated pattern as
-- csr_daily_report_entries/csr_mistake_log_entries (any signed-in company
-- member can read/write everything) rather than the row-scoped pattern
-- used for csr_gh_tracker_entries — the LTP Report is already one shared
-- page every CSR role opens together, not an agent's private tool.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — reuses csr_daily_report_extras_stamp() (migration 0276).
-- Run once in the Supabase SQL Editor, after 0317.
-- =====================================================================

create table if not exists csr_ltp_report_notes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  branch      text not null,
  note_date   date not null,
  csr         text,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, branch, note_date)
);
create index if not exists idx_csr_ltp_report_notes_company on csr_ltp_report_notes(company_id);
create index if not exists idx_csr_ltp_report_notes_date on csr_ltp_report_notes(note_date);

drop trigger if exists trg_csr_ltp_report_notes_stamp on csr_ltp_report_notes;
create trigger trg_csr_ltp_report_notes_stamp before insert or update on csr_ltp_report_notes
  for each row execute function csr_daily_report_extras_stamp();

-- ---------- RLS: company-scoped, same pattern as csr_teams (0031) ----------
alter table csr_ltp_report_notes enable row level security;
alter table csr_ltp_report_notes force row level security;

drop policy if exists csr_ltp_report_notes_select on csr_ltp_report_notes;
create policy csr_ltp_report_notes_select on csr_ltp_report_notes
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists csr_ltp_report_notes_insert on csr_ltp_report_notes;
create policy csr_ltp_report_notes_insert on csr_ltp_report_notes
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists csr_ltp_report_notes_update on csr_ltp_report_notes;
create policy csr_ltp_report_notes_update on csr_ltp_report_notes
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists csr_ltp_report_notes_delete on csr_ltp_report_notes;
create policy csr_ltp_report_notes_delete on csr_ltp_report_notes
  for delete using (company_id = auth_company_id() or is_superadmin());
