-- =====================================================================
-- 0125 — Tech Payroll manual pay items (LDT, Mileage, Training Paid, OW Incentive)
--
-- Unlike the repair-type-based pieces of Tech Payroll (tech_repair_rates,
-- migration 0120 — auto-counted from completed visits), these have no
-- underlying ticket/visit data to count from: Long Distance Tickets (LDT),
-- Mileage, and Training Paid are entered by Finance directly, per
-- technician per pay period, on the Tech Payroll tab. The $/unit rate for
-- each is configured the same way as repair types — as ordinary rows in
-- tech_repair_rates, using "LDT", "Mileage", and "Training Paid" as the
-- repair_type value (see TechPayrollSetup.tsx) — so this table only ever
-- stores the raw entered value, never a computed dollar amount.
--
-- ow_incentive_pct is a manually-entered percentage (0-100), also per
-- technician per period, applied client-side against that period's total
-- payment on the Tech Activity Report modal — no rate row needed since the
-- percentage itself IS the entered value.
--
-- Keyed by (profile_id, period_start, period_end) so switching the Payroll
-- tab's period back to one already entered shows the same values instead
-- of a blank row.
--
-- Run once in the Supabase SQL Editor, after 0124.
-- =====================================================================

create table if not exists tech_manual_pay_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  profile_id        uuid not null references profiles(id) on delete cascade,
  period_start      date not null,
  period_end        date not null,
  ldt_count         numeric not null default 0,
  mileage           numeric not null default 0,
  training_value    numeric not null default 0,
  ow_incentive_pct  numeric not null default 0,
  updated_at        timestamptz not null default now(),
  unique (profile_id, period_start, period_end)
);
create index if not exists idx_tech_manual_pay_items_period on tech_manual_pay_items(company_id, period_start, period_end);

create or replace function tech_manual_pay_items_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tech_manual_pay_items_stamp on tech_manual_pay_items;
create trigger trg_tech_manual_pay_items_stamp before insert or update on tech_manual_pay_items
  for each row execute function tech_manual_pay_items_stamp_and_touch();

alter table tech_manual_pay_items enable row level security;
alter table tech_manual_pay_items force row level security;

drop policy if exists tech_manual_pay_items_select on tech_manual_pay_items;
create policy tech_manual_pay_items_select on tech_manual_pay_items
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_manual_pay_items_insert on tech_manual_pay_items;
create policy tech_manual_pay_items_insert on tech_manual_pay_items
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_manual_pay_items_update on tech_manual_pay_items;
create policy tech_manual_pay_items_update on tech_manual_pay_items
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_manual_pay_items_delete on tech_manual_pay_items;
create policy tech_manual_pay_items_delete on tech_manual_pay_items
  for delete using (company_id = auth_company_id() or is_superadmin());
