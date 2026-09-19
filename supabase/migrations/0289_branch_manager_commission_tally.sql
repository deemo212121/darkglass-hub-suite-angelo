-- =====================================================================
-- 0289 — Manual per-person, per-pay-period tally backing the Accounting
-- Dashboard's "Branch Commission" tab (src/components/
-- BranchManagerCommissionTab.tsx). Commission is earned by the PERSON
-- holding a Branch Manager-tier role (Branch Manager, Senior Branch
-- Manager, Technical Director, Technical Assistant Director — same
-- BM_AND_UP_ROLES group src/lib/roleLabels.ts already defines for the
-- Staff Form Checklist tier), tiered off their branch's Completion Ratio
-- and LTP (Long Term Pending) %, multiplied by their branch's completed-
-- ticket count for the period — none of the three are derivable from an
-- existing table (there's no single "completed ticket" definition in
-- this app that matches what Finance means by this), so all three are
-- typed in by hand, per person.
--
-- One row per (profile, period) — the tab computes the commission tier
-- and $ amount live from these three columns; nothing here stores the
-- computed tier/dollar amount itself, so it can never drift from the
-- policy logic (src/lib/supabase/branchManagerCommission.ts's
-- resolveCommissionTier).
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as parts_daily_issues_log (0288).
-- Run once in the Supabase SQL Editor, after 0288.
-- =====================================================================

create table if not exists branch_manager_commission_tally (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  profile_id        uuid not null references profiles(id) on delete cascade,
  period_start      date not null,
  period_end        date not null,
  completion_pct    numeric not null default 0,
  ltp_pct           numeric not null default 0,
  completed_tickets integer not null default 0 check (completed_tickets >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, profile_id, period_start, period_end)
);
create index if not exists idx_branch_manager_commission_tally_period on branch_manager_commission_tally(company_id, period_start, period_end);
create index if not exists idx_branch_manager_commission_tally_profile on branch_manager_commission_tally(profile_id);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function branch_manager_commission_tally_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_branch_manager_commission_tally_stamp on branch_manager_commission_tally;
create trigger trg_branch_manager_commission_tally_stamp before insert or update on branch_manager_commission_tally
  for each row execute function branch_manager_commission_tally_stamp();

-- ---------- RLS: company-scoped, same pattern as parts_daily_issues_log (0288) ----------
alter table branch_manager_commission_tally enable row level security;
alter table branch_manager_commission_tally force row level security;

drop policy if exists branch_manager_commission_tally_select on branch_manager_commission_tally;
create policy branch_manager_commission_tally_select on branch_manager_commission_tally
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_manager_commission_tally_insert on branch_manager_commission_tally;
create policy branch_manager_commission_tally_insert on branch_manager_commission_tally
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_manager_commission_tally_update on branch_manager_commission_tally;
create policy branch_manager_commission_tally_update on branch_manager_commission_tally
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_manager_commission_tally_delete on branch_manager_commission_tally;
create policy branch_manager_commission_tally_delete on branch_manager_commission_tally
  for delete using (company_id = auth_company_id() or is_superadmin());
