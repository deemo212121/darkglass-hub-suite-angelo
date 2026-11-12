-- =====================================================================
-- 0444 — Accounting → Expenses → Other Expenses (branch expenses).
--
-- A branch's own running costs — not tied to an employee like the
-- `expenses` table is: Utility, Lease, Internet, Phone, or Other (with its
-- own label, e.g. "Pest control"). One row per bill:
--   Branch · Category · Vendor / provider · Amount · Bill date
--   Billing period (optional) · Notes · receipt / bill files
-- The page totals them per branch and per category (the branch report).
--
-- Access:
--   add / edit / delete : Finance (Accounting), Admin, Super Admin
--   read                : the same
-- Files go to the same Storage folder as other expense receipts
-- (companies/{company_id}/expenses/branch-{id}/…).
--
-- New table and functions only — nothing else is changed.
-- Safe to run again. Run once in the Supabase SQL Editor, after 0443.
-- =====================================================================

create or replace function branch_expenses_can_access()
returns boolean language sql stable security definer set search_path = public as $$
  select is_finance() or is_admin() or is_company_superadmin() or is_superadmin();
$$;

create table if not exists branch_expenses (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  branch          text not null check (btrim(branch) <> ''),
  category        text not null check (category in ('utility', 'lease', 'internet', 'phone', 'other')),
  -- Only for category 'other' — what it is ("Pest control", "Security").
  other_label     text not null default '',
  vendor          text not null default '',
  amount          numeric(12,2) not null check (amount >= 0),
  expense_date    date not null default current_date,
  period_start    date,
  period_end      date,
  notes           text not null default '',
  -- [{ "url": "...", "path": "...", "name": "bill.pdf" }]
  receipts        jsonb not null default '[]'::jsonb,
  created_by      uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  check (category <> 'other' or btrim(other_label) <> ''),
  check (period_start is null or period_end is null or period_start <= period_end)
);

create index if not exists idx_branch_expenses_company_date on branch_expenses(company_id, expense_date desc);
create index if not exists idx_branch_expenses_company_branch on branch_expenses(company_id, branch);

-- Who added / last changed it, from the signed-in profile (not trusted from the page).
create or replace function branch_expenses_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id());
begin
  if tg_op = 'INSERT' then
    new.company_id := auth_company_id();
    new.created_by := auth_profile_id();
    new.created_by_name := v_name;
    new.created_at := now();
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
  end if;
  new.updated_by_name := v_name;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_branch_expenses_stamp on branch_expenses;
create trigger trg_branch_expenses_stamp before insert or update on branch_expenses
  for each row execute function branch_expenses_stamp();

alter table branch_expenses enable row level security;

drop policy if exists branch_expenses_select on branch_expenses;
create policy branch_expenses_select on branch_expenses
  for select using (company_id = auth_company_id() and branch_expenses_can_access());

drop policy if exists branch_expenses_insert on branch_expenses;
create policy branch_expenses_insert on branch_expenses
  for insert with check (branch_expenses_can_access());

drop policy if exists branch_expenses_update on branch_expenses;
create policy branch_expenses_update on branch_expenses
  for update using (company_id = auth_company_id() and branch_expenses_can_access())
  with check (company_id = auth_company_id() and branch_expenses_can_access());

drop policy if exists branch_expenses_delete on branch_expenses;
create policy branch_expenses_delete on branch_expenses
  for delete using (company_id = auth_company_id() and branch_expenses_can_access());
