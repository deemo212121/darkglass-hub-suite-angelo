-- =====================================================================
-- 0135 — Ticket Claim Details: the Pre-Claim modal's persisted fields
--
-- Backs the "Pre Claim" action on Need Claim List (NeedClaimList.tsx),
-- modeled on the legacy EarlyRepair system's "Pre-Claim Information"
-- modal. One row per ticket (1:1), created on first save from that modal.
--
-- Several of these fields replace state that already existed elsewhere in
-- the app but was never actually persisted:
--  - pre_claim_status / claim_note: previously pure useState in
--    NeedClaimList.tsx (rowOverrides) — reset on every page reload.
--  - labor_fee / other_fee / shipping_fee / extra_mile_fee / mileage_fee:
--    previously the ClaimTransactionRow grid on ticket.$ticketNo.tsx,
--    also component-state-only, never written to Supabase.
--  - posting_date / service_contract_no / call_status: previously local
--    fields on the ticket detail page's "Product Info" panel, sourced
--    fresh from NSA/ServicePower sync data each load and never stored.
-- part_fee and claim_total are NOT stored here — both are always computed
-- live (part_fee from parts.status = 'Used' rows' price × (1+markup%);
-- claim_total = labor + part + other + shipping + extra_mile + mileage)
-- so they can never drift from the numbers that produced them.
--
-- repair_category / repair_level / service_type / job_code / repair_type /
-- failure_defect_code / resolution_code are free text, not fixed-option
-- dropdowns — this app has no existing taxonomy for any of them to draw
-- from, and a wrong invented preset list would be worse than free text.
--
-- Run once in the Supabase SQL Editor, after 0134.
-- =====================================================================

create table if not exists ticket_claim_details (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  ticket_id             uuid not null unique references tickets(id) on delete cascade,

  pre_claim_status      text,   -- 'Holding' | 'Need Claim' | 'Claim Not Needed' | 'Claimed'
  claim_note            text,
  dealer_stock_repair   boolean not null default false,
  service_contract_no   text,
  call_status           text,

  posting_date          date,
  start_date            date,
  complete_date         date,
  repair_category       text,
  repair_level          text,
  service_type          text,
  job_code              text,
  repair_type           text,
  diagnostic_only       boolean not null default false,
  parts_only_warranty   boolean not null default false,
  failure_defect_code   text,
  resolution_code       text,

  labor_fee             numeric not null default 0,
  other_fee             numeric not null default 0,
  shipping_fee          numeric not null default 0,
  extra_mile_fee        numeric not null default 0,
  mileage_fee           numeric not null default 0,
  po_amount             numeric not null default 0,

  updated_at            timestamptz not null default now(),
  updated_by            uuid references profiles(id) on delete set null
);
create index if not exists idx_ticket_claim_details_company on ticket_claim_details(company_id);

create or replace function ticket_claim_details_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ticket_claim_details_stamp on ticket_claim_details;
create trigger trg_ticket_claim_details_stamp before insert or update on ticket_claim_details
  for each row execute function ticket_claim_details_stamp_and_touch();

alter table ticket_claim_details enable row level security;
alter table ticket_claim_details force row level security;

drop policy if exists ticket_claim_details_select on ticket_claim_details;
create policy ticket_claim_details_select on ticket_claim_details
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_claim_details_insert on ticket_claim_details;
create policy ticket_claim_details_insert on ticket_claim_details
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_claim_details_update on ticket_claim_details;
create policy ticket_claim_details_update on ticket_claim_details
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_claim_details_delete on ticket_claim_details;
create policy ticket_claim_details_delete on ticket_claim_details
  for delete using (company_id = auth_company_id() or is_superadmin());
