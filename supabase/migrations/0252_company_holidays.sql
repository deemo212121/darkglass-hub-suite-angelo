-- Company Holidays — one row per (company, year, holiday), editable so HR
-- can move a specific year's observed date without affecting other years.
-- "country" scopes a holiday to US or PH employees (assigned_branch =
-- 'Philippines' is this app's existing US/PH signal — see e.g.
-- gmailBridge.ts's resolveEmployeeRegion) since the two offices don't
-- necessarily share the same holiday calendar. Rows are created lazily by
-- the client (seeding the standard US federal holidays' computed dates for
-- a year the first time it's viewed) rather than pre-populated here, so
-- the "move the holiday" edit always applies to a real, editable row.

create table if not exists company_holidays (
  id           uuid primary key default uuid_generate_v4(),
  company_id   uuid not null references companies(id) on delete cascade,
  year         int not null,
  country      text not null default 'US' check (country in ('US', 'PH')),
  name         text not null,
  date         date not null,
  -- Distinguishes an auto-seeded federal holiday (still fully editable) from
  -- one HR added by hand — purely informational, e.g. for a "Reset to
  -- federal default" action to know what it can safely overwrite.
  is_custom    boolean not null default false,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_company_holidays_company_year on company_holidays(company_id, year, country);

create or replace function company_holidays_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_company_holidays_touch on company_holidays;
create trigger trg_company_holidays_touch
  before update on company_holidays
  for each row execute function company_holidays_touch_updated_at();

alter table company_holidays enable row level security;
alter table company_holidays force row level security;

create trigger trg_company_holidays_company
  before insert on company_holidays
  for each row execute function set_company_id();

create policy company_holidays_select on company_holidays
  for select using (company_id = auth_company_id() or is_superadmin());

create policy company_holidays_insert on company_holidays
  for insert with check (company_id = auth_company_id() or is_superadmin());

create policy company_holidays_update on company_holidays
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

create policy company_holidays_delete on company_holidays
  for delete using (company_id = auth_company_id() or is_superadmin());
