-- =====================================================================
-- 0426 — Technician incentives (HR → Accounting approval → payroll)
--
-- HR / Accounting → Incentives (IncentivesPage.tsx). When a technician
-- reaches 6 months (counted from their start date, src/lib/techIncentives.ts):
--   hr                $100 to the HR recruiter credited with the hire
--                     (Colleen, Wincel or Kyle)
--   branch_manager    $500 to the Branch Manager, when the technician is
--                     still employed and their 6-month average grade is C
--                     or better
--   technician_match  $500 to the technician, added automatically when the
--                     Branch Manager's incentive is approved (match_of
--                     points at it)
-- HR submits (status 'pending'); Accounting (Finance) or Super Admin
-- approves or rejects. Approving adds the amount to payroll for the pay
-- period it's approved in — pay_line_id is the tech_custom_pay_items row
-- (Branch Manager / technician) or the payroll_adjustments row (HR) — so
-- undoing an approval can remove it again.
--
-- One row per technician per kind. HR, Admin, Finance and Super Admin read
-- every row; the person being paid can read their own.
--
-- New table only — no existing data is touched. Safe to rerun.
-- Run once in the Supabase SQL Editor, after 0425.
-- =====================================================================

create or replace function is_incentive_approver()
returns boolean language sql stable security definer set search_path = public as $$
  select is_finance() or is_company_superadmin() or is_superadmin();
$$;

create or replace function is_incentive_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select is_hr() or is_admin() or is_incentive_approver();
$$;

create table if not exists tech_incentives (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  technician_id      uuid not null references profiles(id) on delete cascade,
  kind               text not null check (kind in ('hr', 'branch_manager', 'technician_match')),
  recipient_id       uuid not null references profiles(id) on delete cascade,
  amount             numeric(12,2) not null check (amount >= 0),
  start_date         date not null,
  six_month_date     date not null,
  -- Branch Manager incentive: the 6-month average points, its letter
  -- grade, and each pay period's [{start, end, points, grade}].
  grade_points       numeric,
  grade              text,
  grade_periods      jsonb not null default '[]'::jsonb,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by       uuid references profiles(id) on delete set null,
  submitted_by_name  text,
  submitted_at       timestamptz not null default now(),
  reviewed_by        uuid references profiles(id) on delete set null,
  reviewed_by_name   text,
  reviewed_at        timestamptz,
  review_note        text,
  pay_period_start   date,
  pay_period_end     date,
  pay_line_id        uuid,
  match_of           uuid references tech_incentives(id) on delete cascade,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint tech_incentives_one_per_kind unique (company_id, technician_id, kind)
);
create index if not exists idx_tech_incentives_status on tech_incentives(company_id, status);

create or replace function tech_incentives_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  -- A service-role write (no signed-in user) is trusted as-is.
  if auth_profile_id() is null then
    return new;
  end if;
  -- Only Accounting approves or rejects, and only Accounting changes an
  -- approved incentive (e.g. undoing it). HR may submit and resubmit.
  if not is_incentive_approver() then
    if tg_op = 'INSERT' and new.status <> 'pending' then
      raise exception 'Only Accounting can approve or reject incentives.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (old.status = 'approved' or new.status <> 'pending') then
      raise exception 'Only Accounting can approve or reject incentives.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tech_incentives_stamp on tech_incentives;
create trigger trg_tech_incentives_stamp before insert or update on tech_incentives
  for each row execute function tech_incentives_stamp();

alter table tech_incentives enable row level security;
alter table tech_incentives force row level security;

drop policy if exists tech_incentives_select on tech_incentives;
create policy tech_incentives_select on tech_incentives
  for select using (
    (company_id = auth_company_id() and (is_incentive_staff() or recipient_id = auth_profile_id()))
    or is_superadmin()
  );

drop policy if exists tech_incentives_insert on tech_incentives;
create policy tech_incentives_insert on tech_incentives
  for insert with check ((company_id = auth_company_id() and is_incentive_staff()) or is_superadmin());

drop policy if exists tech_incentives_update on tech_incentives;
create policy tech_incentives_update on tech_incentives
  for update
  using ((company_id = auth_company_id() and is_incentive_staff()) or is_superadmin())
  with check ((company_id = auth_company_id() and is_incentive_staff()) or is_superadmin());

-- HR can withdraw one that isn't approved; an approved one only Accounting.
drop policy if exists tech_incentives_delete on tech_incentives;
create policy tech_incentives_delete on tech_incentives
  for delete using (
    (company_id = auth_company_id() and (is_incentive_approver() or (status <> 'approved' and is_incentive_staff())))
    or is_superadmin()
  );
