-- =====================================================================
-- 0164 — Truck Stock branch-to-branch transfer requests
--
-- Distinct from truck_stock_pull_requests (0047, ticket-driven: pulling
-- a part FROM Truck Stock to fulfill a Part Transaction line). This is
-- for moving existing Truck Stock inventory from one branch to another,
-- unrelated to any specific ticket — e.g. Branch A has 5 units of a part
-- and Branch B needs some.
--
-- Requester picks a part currently in stock at a source branch and asks
-- for `quantity` of it to be sent to a destination branch. The source
-- branch's on-hand quantity is decremented (reserved) immediately at
-- request time, same "reserve now, review after" pattern as 0047 — so a
-- second requester can't also claim the same units while this is
-- pending. The destination branch's Parts Manager reviews it:
--   pending  -> requested, still physically at the source branch.
--   approved -> Parts Manager signed off; parts are now considered in
--               transit from source to destination. No quantity moves
--               yet (they're not physically at the destination).
--   rejected -> declined; the reserved quantity is restored at the
--               source branch (rejection_reason optional).
--   received -> destination confirms physical arrival; THIS is when the
--               destination branch's on-hand quantity is incremented,
--               completing the transfer.
-- This four-state status is the "where is the parts right now" the app
-- surfaces on the Branch Transfers tab.
--
-- Run once in the Supabase SQL Editor, after 0163.
-- =====================================================================

create table if not exists truck_stock_transfer_requests (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  part_no           text not null,
  description       text,
  manufacturer      text,
  quantity          integer not null default 1,
  from_branch       text not null,
  to_branch         text not null,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'received')),
  notes             text,
  requested_by      uuid references profiles(id),
  requested_at      timestamptz not null default now(),
  reviewed_by       uuid references profiles(id),
  reviewed_at       timestamptz,
  rejection_reason  text,
  received_by       uuid references profiles(id),
  received_at       timestamptz
);

create index if not exists idx_truck_stock_transfer_requests_company_status
  on truck_stock_transfer_requests (company_id, status);
create index if not exists idx_truck_stock_transfer_requests_to_branch
  on truck_stock_transfer_requests (company_id, to_branch);

-- ---------- Auto-stamp company_id + requested_by from the caller's session ----------
create or replace function truck_stock_transfer_requests_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.requested_by is null then
    new.requested_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_truck_stock_transfer_requests_stamp on truck_stock_transfer_requests;
create trigger trg_truck_stock_transfer_requests_stamp
  before insert on truck_stock_transfer_requests
  for each row execute function truck_stock_transfer_requests_stamp();

-- ---------- RLS: company-scoped, matches truck_stock_pull_requests pattern ----------
alter table truck_stock_transfer_requests enable row level security;
alter table truck_stock_transfer_requests force row level security;

drop policy if exists truck_stock_transfer_requests_select on truck_stock_transfer_requests;
create policy truck_stock_transfer_requests_select on truck_stock_transfer_requests
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists truck_stock_transfer_requests_insert on truck_stock_transfer_requests;
create policy truck_stock_transfer_requests_insert on truck_stock_transfer_requests
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists truck_stock_transfer_requests_update on truck_stock_transfer_requests;
create policy truck_stock_transfer_requests_update on truck_stock_transfer_requests
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
