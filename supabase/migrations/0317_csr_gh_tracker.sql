-- =====================================================================
-- 0317 — GH Tracker: replaces CSR Self Service (CsrSelfServiceTally.tsx,
-- a "+1" counter writing into csr_daily_report_entries.gh/schedule/attempt/
-- updateCount) with a real per-CSR log of the phone numbers they've called
-- or attempted to reach that day — matching the reference spreadsheet
-- (one column of numbers per CSR). GH itself is now just the count of that
-- day's rows for that CSR (see getGhCountsByProfileForRange,
-- csrGhTracker.ts), read live by the Daily Report's GH column
-- (CSRTeamDailyReport.tsx) the same way Schedule/Update/Total already are.
--
-- Two very different views read this table (CsrGhTracker.tsx):
--   - A CSR_AGENT/CSR_TEAM_LEADER sees and can add/edit/delete ONLY their
--     own rows — this is deliberately NOT the "any company member can see
--     everything" RLS pattern the rest of the CSR Daily Report tables use
--     (csr_daily_report_entries, csr_mistake_log_entries, ...), because
--     those are all edited from the shared manager-facing Daily Report page
--     where page-level access already gates who gets there. This table is
--     opened directly by individual agents, so the row-level boundary has
--     to be real, not just "which page can you open."
--   - A CSR_MANAGER (not CSR_TEAM_LEADER — same narrower tier
--     isCsrManagerRole() in roleLabels.ts singles out, e.g. for the
--     visibleAttendanceProfileIds team-roster grant) sees every CSR's rows
--     for the picked date, laid out spreadsheet-style like the reference.
--
-- Run once in the Supabase SQL Editor, after 0316.
-- =====================================================================

create table if not exists csr_gh_tracker_entries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  entry_date    date not null,
  phone_number  text not null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_csr_gh_tracker_entries_company on csr_gh_tracker_entries(company_id);
create index if not exists idx_csr_gh_tracker_entries_profile_date on csr_gh_tracker_entries(profile_id, entry_date);
create index if not exists idx_csr_gh_tracker_entries_date on csr_gh_tracker_entries(entry_date);

-- Reuses 0276's generic before-insert/update stamp (company_id + updated_at)
-- — same trigger function csr_mistake_log_entries (0277) already shares.
drop trigger if exists trg_csr_gh_tracker_entries_stamp on csr_gh_tracker_entries;
create trigger trg_csr_gh_tracker_entries_stamp before insert or update on csr_gh_tracker_entries
  for each row execute function csr_daily_report_extras_stamp();

create or replace function is_csr_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (role = 'CSR_MANAGER' or 'CSR_MANAGER' = any(extra_roles))
  );
$$;

-- ---------- RLS ----------
alter table csr_gh_tracker_entries enable row level security;
alter table csr_gh_tracker_entries force row level security;

-- Read: your own rows always; every row company-wide if you're CSR_MANAGER,
-- Admin, or company-superadmin (the "manager's end" aggregated view).
drop policy if exists csr_gh_tracker_entries_select on csr_gh_tracker_entries;
create policy csr_gh_tracker_entries_select on csr_gh_tracker_entries
  for select using (
    is_superadmin()
    or (
      company_id = auth_company_id()
      and (profile_id = auth_profile_id() or is_csr_manager() or is_admin() or is_company_superadmin())
    )
  );

-- Write: always as yourself — even a manager viewing the aggregated table
-- doesn't add/edit entries on an agent's behalf here, only Admin/company-
-- superadmin can fix a wrong row (data-correction override, same as most
-- other tables in this app).
drop policy if exists csr_gh_tracker_entries_insert on csr_gh_tracker_entries;
create policy csr_gh_tracker_entries_insert on csr_gh_tracker_entries
  for insert with check (
    company_id = auth_company_id() and profile_id = auth_profile_id()
  );

drop policy if exists csr_gh_tracker_entries_update on csr_gh_tracker_entries;
create policy csr_gh_tracker_entries_update on csr_gh_tracker_entries
  for update using (
    profile_id = auth_profile_id() or is_admin() or is_company_superadmin() or is_superadmin()
  )
  with check (
    profile_id = auth_profile_id() or is_admin() or is_company_superadmin() or is_superadmin()
  );

drop policy if exists csr_gh_tracker_entries_delete on csr_gh_tracker_entries;
create policy csr_gh_tracker_entries_delete on csr_gh_tracker_entries
  for delete using (
    profile_id = auth_profile_id() or is_admin() or is_company_superadmin() or is_superadmin()
  );
