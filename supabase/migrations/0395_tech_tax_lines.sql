-- =====================================================================
-- 0395 — Tech Activity Report tax lines
--
-- Tax lines Finance can add per technician per pay period, shown BELOW
-- Total Payment on the Tech Activity Report modal. Each line is either a
-- percentage of Total Payment or a fixed dollar amount; the modal shows
-- Net Pay After Tax = Total Payment − all tax lines. They don't feed Total
-- Payment, Gross Pay, the OT premium or any guarantee/state match — those
-- stay exactly as they were.
--
-- Run once in the Supabase SQL Editor, after 0394. Safe to run twice.
-- (Numbered 0393 in janeyyy16's repo — renumbered here past this repo's own
-- 0393-0394; already applied to the shared database 2026-10-19.)
-- =====================================================================

create table if not exists tech_tax_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  label         text not null default '',
  mode          text not null default 'percent' check (mode in ('percent', 'fixed')),
  amount        numeric not null default 0,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_tech_tax_lines_period on tech_tax_lines(company_id, profile_id, period_start, period_end);

create or replace function tech_tax_lines_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tech_tax_lines_stamp on tech_tax_lines;
create trigger trg_tech_tax_lines_stamp before insert or update on tech_tax_lines
  for each row execute function tech_tax_lines_stamp_and_touch();

alter table tech_tax_lines enable row level security;
alter table tech_tax_lines force row level security;

drop policy if exists tech_tax_lines_select on tech_tax_lines;
create policy tech_tax_lines_select on tech_tax_lines
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_tax_lines_insert on tech_tax_lines;
create policy tech_tax_lines_insert on tech_tax_lines
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_tax_lines_update on tech_tax_lines;
create policy tech_tax_lines_update on tech_tax_lines
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_tax_lines_delete on tech_tax_lines;
create policy tech_tax_lines_delete on tech_tax_lines
  for delete using (company_id = auth_company_id() or is_superadmin());
