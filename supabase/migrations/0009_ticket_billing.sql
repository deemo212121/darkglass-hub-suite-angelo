-- =====================================================================
-- 0009 — Ticket Billing (mobile Service Report › Billing tab)
-- One billing record per ticket. Stores the payment breakdown, payment
-- method, comment, and the customer signature (data URL). Company-scoped
-- via RLS like every other tenant table.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists ticket_billing (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null,
  labor           numeric(12,2) default 0,
  labor_taxable   boolean default true,
  parts           numeric(12,2) default 0,
  parts_taxable   boolean default true,
  parts_used      text,                       -- free text like "0.00 / 62.47"
  diagnose        numeric(12,2) default 0,     -- Diagnose (Trip)
  diagnose_taxable boolean default true,
  others          numeric(12,2) default 0,
  others_taxable  boolean default true,
  tax_rate        numeric(6,3) default 0,      -- percent
  tax             numeric(12,2) default 0,
  deduction       numeric(12,2) default 0,
  total           numeric(12,2) default 0,
  customer_name   text,
  payment_method  text,                        -- Cash / Check / Credit Card / Ext Warranty
  comment         text,
  signature       text,                        -- data URL (image/png)
  created_by      uuid references profiles(id),
  updated_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint billing_ticket_same_company
    foreign key (ticket_id, company_id) references tickets(id, company_id) on delete cascade,
  unique (ticket_id)
);
create index if not exists idx_ticket_billing_ticket on ticket_billing(ticket_id);

-- RLS: company-scoped, mirroring the tenant-table pattern in 0001_init.
alter table ticket_billing enable row level security;
alter table ticket_billing force row level security;

drop policy if exists ticket_billing_select on ticket_billing;
create policy ticket_billing_select on ticket_billing
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_billing_insert on ticket_billing;
create policy ticket_billing_insert on ticket_billing
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_billing_update on ticket_billing;
create policy ticket_billing_update on ticket_billing
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_billing_delete on ticket_billing;
create policy ticket_billing_delete on ticket_billing
  for delete using (company_id = auth_company_id() or is_superadmin());

-- Auto-stamp company_id on insert.
drop trigger if exists trg_ticket_billing_company on ticket_billing;
create trigger trg_ticket_billing_company
  before insert on ticket_billing
  for each row execute function set_company_id();
