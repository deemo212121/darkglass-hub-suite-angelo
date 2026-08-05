-- =====================================================================
-- 0127 — Tech Payroll custom pay items ("(custom program)" lines)
--
-- Freeform, ad-hoc bonus lines Finance can add per technician per pay
-- period on the Tech Activity Report modal — label + value + rate,
-- multiplied into a payment the same way every other manual category is.
-- Unlike tech_manual_pay_items (a fixed set of columns: LDT, Mileage,
-- Training Paid, OW Incentive), a technician can have any number of these
-- per period, so it's its own table with one row per line instead of a
-- single upserted row.
--
-- Run once in the Supabase SQL Editor, after 0126.
-- =====================================================================

create table if not exists tech_custom_pay_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  label         text not null default '',
  value         numeric not null default 0,
  rate          numeric not null default 0,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_tech_custom_pay_items_period on tech_custom_pay_items(company_id, profile_id, period_start, period_end);

create or replace function tech_custom_pay_items_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tech_custom_pay_items_stamp on tech_custom_pay_items;
create trigger trg_tech_custom_pay_items_stamp before insert or update on tech_custom_pay_items
  for each row execute function tech_custom_pay_items_stamp_and_touch();

alter table tech_custom_pay_items enable row level security;
alter table tech_custom_pay_items force row level security;

drop policy if exists tech_custom_pay_items_select on tech_custom_pay_items;
create policy tech_custom_pay_items_select on tech_custom_pay_items
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_custom_pay_items_insert on tech_custom_pay_items;
create policy tech_custom_pay_items_insert on tech_custom_pay_items
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_custom_pay_items_update on tech_custom_pay_items;
create policy tech_custom_pay_items_update on tech_custom_pay_items
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_custom_pay_items_delete on tech_custom_pay_items;
create policy tech_custom_pay_items_delete on tech_custom_pay_items
  for delete using (company_id = auth_company_id() or is_superadmin());
