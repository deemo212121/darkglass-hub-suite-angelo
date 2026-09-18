-- =====================================================================
-- 0274 — eBay Daily Report (Parts module): backs the new "Parts Daily
-- Report eBAY" dashboard tile, replacing the manual "Ebay Daily
-- Reports.xlsx" workbook (141 stacked daily blocks in one sheet, plus
-- 7 inconsistent per-branch listings tabs, no grand totals, no
-- sold-vs-listed reconciliation).
--
-- Two tables mirror the workbook's two data domains:
--   ebay_orders   — completed orders (was the "ALL SALES" sheet)
--   ebay_listings — items currently listed for sale (was the 7
--                   "* LISTINGS" sheets)
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as hr_hiring_report_manual_entries (0273).
-- Run once in the Supabase SQL Editor, after 0273.
-- =====================================================================

create table if not exists ebay_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  order_ext_id    text,
  part_no         text,
  quantity        integer not null default 1,
  status          text not null check (status in ('Shipped','Cancelled','Returned','Refunded','Pending')),
  order_earnings  numeric not null default 0,
  order_date      date not null,
  sales_account   text not null,
  branch          text not null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_ebay_orders_company_date on ebay_orders(company_id, order_date);
create index if not exists idx_ebay_orders_branch on ebay_orders(company_id, branch);

create table if not exists ebay_listings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  part_no       text,
  ebay_account  text not null,
  branch        text not null,
  price         numeric not null default 0,
  quantity      integer not null default 1,
  listed_date   date not null,
  status        text not null default 'Listed' check (status in ('Listed','Sold')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_ebay_listings_company_date on ebay_listings(company_id, listed_date);
create index if not exists idx_ebay_listings_branch on ebay_listings(company_id, branch);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function ebay_orders_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_ebay_orders_stamp on ebay_orders;
create trigger trg_ebay_orders_stamp before insert or update on ebay_orders
  for each row execute function ebay_orders_stamp();

create or replace function ebay_listings_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_ebay_listings_stamp on ebay_listings;
create trigger trg_ebay_listings_stamp before insert or update on ebay_listings
  for each row execute function ebay_listings_stamp();

-- ---------- RLS: company-scoped, same pattern as csr_teams (0031) ----------
alter table ebay_orders enable row level security;
alter table ebay_orders force row level security;

drop policy if exists ebay_orders_select on ebay_orders;
create policy ebay_orders_select on ebay_orders
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_orders_insert on ebay_orders;
create policy ebay_orders_insert on ebay_orders
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_orders_update on ebay_orders;
create policy ebay_orders_update on ebay_orders
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_orders_delete on ebay_orders;
create policy ebay_orders_delete on ebay_orders
  for delete using (company_id = auth_company_id() or is_superadmin());

alter table ebay_listings enable row level security;
alter table ebay_listings force row level security;

drop policy if exists ebay_listings_select on ebay_listings;
create policy ebay_listings_select on ebay_listings
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_listings_insert on ebay_listings;
create policy ebay_listings_insert on ebay_listings
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_listings_update on ebay_listings;
create policy ebay_listings_update on ebay_listings
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_listings_delete on ebay_listings;
create policy ebay_listings_delete on ebay_listings
  for delete using (company_id = auth_company_id() or is_superadmin());
