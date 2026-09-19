-- =====================================================================
-- 0284 — Branch Daily Report (Reports module).
--
-- One row per (branch, report_date) — mirrors the company's existing
-- "Branch Daily Update" spreadsheet: a shared notes box that the Branch
-- Manager (and the owning Senior Branch Manager, once assigned via
-- 0283) both write into, an Urgency call the Senior Branch Manager sets
-- after reviewing, and a Pending Tickets / Number of Techs snapshot.
--
-- `notes` is a single growing text field, not a separate notes table —
-- the app appends "Name (time): message" to whatever's already there and
-- upserts the whole field, the same way people take turns typing into
-- one spreadsheet cell. Simpler than a threaded-comments table and
-- matches what the reference spreadsheet actually is.
--
-- pending_tickets/number_of_techs are a FROZEN snapshot, not a live
-- query — captured once (counts_captured_at stamped) when the app first
-- computes them for a given day, so a report from last week keeps
-- showing what was true last week even as tickets close/techs move
-- branches. Only today's row is ever recomputed (an explicit "Refresh
-- Counts" action in the app), never a past date's.
--
-- Run once in the Supabase SQL Editor, after 0283.
-- =====================================================================

create table if not exists branch_daily_reports (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  branch             text not null,
  report_date        date not null,
  urgency            text check (urgency in ('low', 'moderate', 'high')),
  notes              text not null default '',
  pending_tickets    integer,
  number_of_techs    integer,
  counts_captured_at timestamptz,
  updated_by         uuid references profiles(id),
  updated_by_name    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, branch, report_date)
);
create index if not exists idx_branch_daily_reports_date on branch_daily_reports(company_id, report_date);
create index if not exists idx_branch_daily_reports_branch on branch_daily_reports(company_id, branch);

create or replace function branch_daily_reports_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_branch_daily_reports_stamp on branch_daily_reports;
create trigger trg_branch_daily_reports_stamp before insert on branch_daily_reports
  for each row execute function branch_daily_reports_stamp();

-- ---------- Who may write to a given branch's report ----------
-- HR-and-above (Admin/SuperAdmin/SuperSuperAdmin/HR) may edit any branch.
-- Otherwise: the current user's own profile must be a Branch Manager
-- whose assigned_branch matches p_branch, OR a Senior Branch Manager
-- assigned to p_branch via senior_branch_manager_branches (0283). Checks
-- role OR extra_roles, same "primary-or-secondary" convention as
-- is_admin()/0093's live-chat visibility check.
create or replace function can_edit_branch_daily_report(p_branch text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  my_id uuid := auth_profile_id();
  my_role text;
  my_extra text[];
  my_branch text;
begin
  if is_hr() or is_admin() or is_company_superadmin() or is_superadmin() then
    return true;
  end if;
  select role, coalesce(extra_roles, '{}'), assigned_branch
    into my_role, my_extra, my_branch
    from profiles where id = my_id;
  if (my_role = 'BRANCH_MANAGER' or 'BRANCH_MANAGER' = any(my_extra)) and my_branch = p_branch then
    return true;
  end if;
  if (my_role = 'SENIOR_BRANCH_MANAGER' or 'SENIOR_BRANCH_MANAGER' = any(my_extra)) and exists (
    select 1 from senior_branch_manager_branches
    where profile_id = my_id and branch = p_branch
  ) then
    return true;
  end if;
  return false;
end;
$$;

-- ---------- RLS ----------
-- Select: everyone in the company (Senior Branch Managers need to see
-- every branch's report, not just their own — same for HR/Admin/anyone
-- else with access to the Reports module page itself).
alter table branch_daily_reports enable row level security;
alter table branch_daily_reports force row level security;

drop policy if exists branch_daily_reports_select on branch_daily_reports;
create policy branch_daily_reports_select on branch_daily_reports
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists branch_daily_reports_insert on branch_daily_reports;
create policy branch_daily_reports_insert on branch_daily_reports
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and can_edit_branch_daily_report(branch)
  );

drop policy if exists branch_daily_reports_update on branch_daily_reports;
create policy branch_daily_reports_update on branch_daily_reports
  for update using (
    (company_id = auth_company_id() or is_superadmin())
    and can_edit_branch_daily_report(branch)
  )
  with check (
    (company_id = auth_company_id() or is_superadmin())
    and can_edit_branch_daily_report(branch)
  );

drop policy if exists branch_daily_reports_delete on branch_daily_reports;
create policy branch_daily_reports_delete on branch_daily_reports
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_hr() or is_admin() or is_company_superadmin() or is_superadmin())
  );
