-- ============================================================================
-- 0422 — Truck Stock: used parts with their ticket number.
--
-- truck_stock_used: one row per (branch, part, ticket) — a part the PROJECT A
--   USAPP inventory workbook marks Used, from a tab's Truck Stock section
--   (ticket # in its NOTE column) or its LIVE section (TICKET #, DATE PICKED,
--   TECH). Filled by Import on Parts → Part Inventory → Truck Stock and listed
--   there under "Used". Kept apart from truck_stock so these never count as
--   stock: Marcone Lookup, pull requests and transfers only read truck_stock.
--
-- Run once in the Supabase SQL Editor. Only creates a new table; nothing that
-- exists is changed.
-- ============================================================================

create table if not exists truck_stock_used (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  branch            text not null,
  part_no           text not null,
  -- '' when the sheet gives none (one row per part then).
  ticket_no         text not null default '',
  quantity          integer not null default 1,
  used_date         date,
  tech              text,
  storage_location  text,
  description       text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint truck_stock_used_unique unique (company_id, branch, part_no, ticket_no)
);

create index if not exists truck_stock_used_branch_idx on truck_stock_used (company_id, branch);
create index if not exists truck_stock_used_ticket_idx on truck_stock_used (company_id, ticket_no);

-- Same stamp as truck_stock (0023): company_id from the caller on insert, updated_at on every write.
drop trigger if exists trg_truck_stock_used_stamp on truck_stock_used;
create trigger trg_truck_stock_used_stamp
  before insert or update on truck_stock_used
  for each row execute function truck_stock_stamp_company();

-- Company-scoped, same shape as truck_stock after 0100.
alter table truck_stock_used enable row level security;
alter table truck_stock_used force row level security;

drop policy if exists truck_stock_used_select on truck_stock_used;
create policy truck_stock_used_select on truck_stock_used
  for select using (company_id = auth_company_id());

drop policy if exists truck_stock_used_insert on truck_stock_used;
create policy truck_stock_used_insert on truck_stock_used
  for insert with check (company_id = auth_company_id());

drop policy if exists truck_stock_used_update on truck_stock_used;
create policy truck_stock_used_update on truck_stock_used
  for update using (company_id = auth_company_id()) with check (company_id = auth_company_id());

drop policy if exists truck_stock_used_delete on truck_stock_used;
create policy truck_stock_used_delete on truck_stock_used
  for delete using (company_id = auth_company_id());
