-- =====================================================================
-- 0174 — External service accounts (Account Management), moved off
-- localStorage into Supabase
--
-- Account Management (/m/admin/account-management, AccountManagementPage.tsx)
-- previously stored every row (American Home Shield, ServicePower, Encompass,
-- Marcone, etc. — the vendor logins used for parts ordering / technician
-- mapping / claims APIs) in window.localStorage only. That meant: (a) the
-- data was per-browser, invisible to any other admin or to the server, and
-- (b) most importantly, the ServicePower credentials the live API bridge
-- actually calls (src/lib/server/servicePowerBridge.ts) were read from a
-- completely disconnected source (.env / build-time constants) — editing
-- and saving the ServicePower row here did nothing to the real integration.
--
-- This table makes it real: company-scoped storage, and
-- servicePowerBridge.ts now checks here FIRST (server-side, service-role
-- read) before falling back to the .env-baked constants — so changing the
-- password in this UI fixes the live API immediately, no redeploy needed.
--
-- Password is stored as plain text behind RLS scoped to this company's
-- Admin/SuperAdmin only (no encryption-at-rest infra exists anywhere else
-- in this codebase either — every other secret lives in .env). The UI
-- renders it in a masked (type="password") input, never as plain text.
--
-- Seeded with this company's two known real rows (American Home Shield,
-- ServicePower) so the migration doesn't wipe out the reference data
-- already visible in the UI — passwords are left blank since real values
-- were never available in code to seed.
--
-- Run once in the Supabase SQL Editor, after 0173.
-- =====================================================================

create table if not exists external_service_accounts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  type               text not null,
  account_no         text not null default '',
  display_name       text not null default '',
  account_id         text not null default '',
  password           text not null default '',
  ref_no_1           text not null default '',
  default_part_dist  text not null default '',
  sync               text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references profiles(id),
  updated_by         uuid references profiles(id)
);
create index if not exists idx_external_service_accounts_company on external_service_accounts(company_id);
-- Bridges (server-side, service-role) look up a row by (company_id, type) —
-- e.g. servicePowerBridge.ts filters type = 'Service Power Account'.
create index if not exists idx_external_service_accounts_company_type on external_service_accounts(company_id, type);

create or replace function external_service_accounts_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth_profile_id());
  end if;
  new.updated_by := auth_profile_id();
  return new;
end;
$$;

drop trigger if exists trg_external_service_accounts_stamp on external_service_accounts;
create trigger trg_external_service_accounts_stamp before insert or update on external_service_accounts
  for each row execute function external_service_accounts_stamp();

alter table external_service_accounts enable row level security;
alter table external_service_accounts force row level security;

-- These are vendor login credentials, not general company data — unlike
-- most company-scoped tables, read access is also restricted to Admin/
-- SuperAdmin (not every signed-in company member), same tier as write.
drop policy if exists external_service_accounts_select on external_service_accounts;
create policy external_service_accounts_select on external_service_accounts
  for select using (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  );

drop policy if exists external_service_accounts_insert on external_service_accounts;
create policy external_service_accounts_insert on external_service_accounts
  for insert with check (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  );

drop policy if exists external_service_accounts_update on external_service_accounts;
create policy external_service_accounts_update on external_service_accounts
  for update using (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  ) with check (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  );

drop policy if exists external_service_accounts_delete on external_service_accounts;
create policy external_service_accounts_delete on external_service_accounts
  for delete using (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  );

-- Seed this company's two known real rows so the UI doesn't go from
-- "showing reference data" to "blank table" the moment this ships.
insert into external_service_accounts (company_id, type, account_no, display_name, ref_no_1)
select 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd', 'American Home Shield Account', 'SHAWA11215713', 'SHAWA11215713 - SHAW,RICO', ''
where not exists (
  select 1 from external_service_accounts
  where company_id = 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd' and type = 'American Home Shield Account'
);

insert into external_service_accounts (company_id, type, account_no, display_name, ref_no_1)
select 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd', 'Service Power Account', '1290884', '', 'GE_Memphis'
where not exists (
  select 1 from external_service_accounts
  where company_id = 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd' and type = 'Service Power Account'
);
