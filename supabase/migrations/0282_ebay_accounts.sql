-- =====================================================================
-- 0282 — eBay seller accounts for the "Parts Daily Report eBAY" feature.
-- Was a hardcoded 2-value list ("Ebay (warehouse_101)", "Ebay
-- (tekp07)") baked into the app; now company-managed from the
-- Assignments tab so a new account doesn't need a code change, and the
-- Orders/Listings "eBay Account" dropdowns stay in sync with whatever
-- list is actually managed there.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as ebay_orders/ebay_listings (0280).
-- Run once in the Supabase SQL Editor, after 0281.
-- =====================================================================

create table if not exists ebay_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name)
);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function ebay_accounts_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_ebay_accounts_stamp on ebay_accounts;
create trigger trg_ebay_accounts_stamp before insert or update on ebay_accounts
  for each row execute function ebay_accounts_stamp();

-- ---------- RLS: company-scoped, same pattern as ebay_orders (0280) ----------
alter table ebay_accounts enable row level security;
alter table ebay_accounts force row level security;

drop policy if exists ebay_accounts_select on ebay_accounts;
create policy ebay_accounts_select on ebay_accounts
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_accounts_insert on ebay_accounts;
create policy ebay_accounts_insert on ebay_accounts
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_accounts_update on ebay_accounts;
create policy ebay_accounts_update on ebay_accounts
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_accounts_delete on ebay_accounts;
create policy ebay_accounts_delete on ebay_accounts
  for delete using (company_id = auth_company_id() or is_superadmin());

-- Seed the two accounts that were previously hardcoded, so existing
-- Orders/Listings rows referencing them still have a matching option
-- in the dropdown after this migration runs. Safe to delete/rename
-- afterward from the Assignments tab.
insert into ebay_accounts (company_id, name)
select id, unnest(array['Ebay (warehouse_101)', 'Ebay (tekp07)'])
from companies
on conflict (company_id, name) do nothing;
