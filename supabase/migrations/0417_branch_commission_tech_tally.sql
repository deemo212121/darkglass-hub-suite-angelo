-- =====================================================================
-- 0417 — Branch Commission, per technician.
--
-- The Accounting Dashboard's "Branch Commission" tab
-- (src/components/BranchManagerCommissionTab.tsx) used to take one typed-in
-- line per Branch Manager (0305). Finance now enters each technician's own
-- Completion % / LTP % / completed tickets for the pay period, and can mark
-- a technician as a trainee for that period — a trainee doesn't count in the
-- bonus. Each branch's numbers (and so its manager's Condition and $) are
-- worked out live from its non-trainee technicians: tickets summed,
-- Completion % and LTP % averaged weighted by tickets
-- (branchCommissionTech.ts). Nothing computed is stored.
--
-- One row per (technician, period). Same company scoping / RLS as 0305.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists branch_commission_tech_tally (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  profile_id        uuid not null references profiles(id) on delete cascade,
  period_start      date not null,
  period_end        date not null,
  completion_pct    numeric not null default 0,
  ltp_pct           numeric not null default 0,
  completed_tickets integer not null default 0 check (completed_tickets >= 0),
  is_trainee        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, profile_id, period_start, period_end)
);
create index if not exists idx_branch_commission_tech_tally_period on branch_commission_tech_tally(company_id, period_start, period_end);
create index if not exists idx_branch_commission_tech_tally_profile on branch_commission_tech_tally(profile_id);

create or replace function branch_commission_tech_tally_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_branch_commission_tech_tally_stamp on branch_commission_tech_tally;
create trigger trg_branch_commission_tech_tally_stamp before insert or update on branch_commission_tech_tally
  for each row execute function branch_commission_tech_tally_stamp();

alter table branch_commission_tech_tally enable row level security;
alter table branch_commission_tech_tally force row level security;

drop policy if exists branch_commission_tech_tally_select on branch_commission_tech_tally;
create policy branch_commission_tech_tally_select on branch_commission_tech_tally
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_tech_tally_insert on branch_commission_tech_tally;
create policy branch_commission_tech_tally_insert on branch_commission_tech_tally
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_tech_tally_update on branch_commission_tech_tally;
create policy branch_commission_tech_tally_update on branch_commission_tech_tally
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists branch_commission_tech_tally_delete on branch_commission_tech_tally;
create policy branch_commission_tech_tally_delete on branch_commission_tech_tally
  for delete using (company_id = auth_company_id() or is_superadmin());
