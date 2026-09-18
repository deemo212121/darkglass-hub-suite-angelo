-- =====================================================================
-- 0287 — Company-managed branch cent-pricing for the "Parts Daily
-- Report eBAY" feature. Was a hardcoded 14-branch table baked into the
-- app (each branch's listing price always ends in a fixed cents value,
-- e.g. Atlanta -> $X.97); now editable from the Assignments tab.
--
-- The set of branches this feature offers everywhere (Orders/Listings
-- branch pickers, Assignments, Daily Branch Report, Total Listed by
-- Branch) is exactly the branches that have a row here — add one here
-- to make a branch show up, delete one to remove it.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as ebay_orders/ebay_listings (0280).
-- Run once in the Supabase SQL Editor, after 0286.
-- =====================================================================

create table if not exists ebay_branch_cents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  branch      text not null,
  cents       integer not null check (cents >= 0 and cents <= 99),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, branch)
);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function ebay_branch_cents_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_ebay_branch_cents_stamp on ebay_branch_cents;
create trigger trg_ebay_branch_cents_stamp before insert or update on ebay_branch_cents
  for each row execute function ebay_branch_cents_stamp();

-- ---------- RLS: company-scoped, same pattern as ebay_orders (0280) ----------
alter table ebay_branch_cents enable row level security;
alter table ebay_branch_cents force row level security;

drop policy if exists ebay_branch_cents_select on ebay_branch_cents;
create policy ebay_branch_cents_select on ebay_branch_cents
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_branch_cents_insert on ebay_branch_cents;
create policy ebay_branch_cents_insert on ebay_branch_cents
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_branch_cents_update on ebay_branch_cents;
create policy ebay_branch_cents_update on ebay_branch_cents
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_branch_cents_delete on ebay_branch_cents;
create policy ebay_branch_cents_delete on ebay_branch_cents
  for delete using (company_id = auth_company_id() or is_superadmin());

-- Seed the 14 branches that were previously hardcoded, so existing
-- Orders/Listings/Assignments rows referencing them keep working after
-- this migration runs. Add/remove/edit freely afterward from the
-- Assignments tab.
insert into ebay_branch_cents (company_id, branch, cents)
select c.id, v.branch, v.cents
from companies c
cross join (values
  ('Atlanta', 97), ('Columbus', 96), ('Jackson, TN', 86), ('Jonesboro', 82),
  ('Jacksonville', 80), ('Jackson, MS', 76), ('Chattanooga', 74), ('Memphis', 93),
  ('Tallahassee', 95), ('Savannah', 92), ('Raleigh', 78), ('Mobile', 89),
  ('Nashville', 91), ('Knoxville', 88)
) as v(branch, cents)
on conflict (company_id, branch) do nothing;
