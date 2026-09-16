-- =====================================================================
-- 0263 — Receiving Status provider portal links
--
-- The Tickets module's Receiving Status page (Admin/SuperAdmin only)
-- groups tickets by portal FAMILY (e.g. "ServicePower" collapses SP/SP1,
-- "ServiceBench" collapses SB/SB-1276506820/SB-Miele — see
-- src/lib/receivingStatusData.ts's providerFamilyOf()), not by the raw
-- ticket_source code. This table lets an Admin type in the real site link
-- for each portal family once, shown as a clickable link on that page.
--
-- One row per (company_id, provider family name). Same access tier as the
-- page itself (Admin/SuperAdmin) for both read and write — this isn't a
-- secret like external_service_accounts' vendor passwords, just a URL, but
-- there's no reason for it to be visible/editable outside the one page
-- that uses it.
-- =====================================================================

create table if not exists receiving_status_provider_links (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  provider    text not null,
  url         text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id),
  unique (company_id, provider)
);
create index if not exists idx_receiving_status_provider_links_company on receiving_status_provider_links(company_id);

create or replace function receiving_status_provider_links_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  new.updated_by := auth_profile_id();
  return new;
end;
$$;

drop trigger if exists trg_receiving_status_provider_links_stamp on receiving_status_provider_links;
create trigger trg_receiving_status_provider_links_stamp before insert or update on receiving_status_provider_links
  for each row execute function receiving_status_provider_links_stamp();

alter table receiving_status_provider_links enable row level security;
alter table receiving_status_provider_links force row level security;

drop policy if exists receiving_status_provider_links_select on receiving_status_provider_links;
create policy receiving_status_provider_links_select on receiving_status_provider_links
  for select using (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  );

drop policy if exists receiving_status_provider_links_insert on receiving_status_provider_links;
create policy receiving_status_provider_links_insert on receiving_status_provider_links
  for insert with check (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  );

drop policy if exists receiving_status_provider_links_update on receiving_status_provider_links;
create policy receiving_status_provider_links_update on receiving_status_provider_links
  for update using (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  ) with check (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  );

drop policy if exists receiving_status_provider_links_delete on receiving_status_provider_links;
create policy receiving_status_provider_links_delete on receiving_status_provider_links
  for delete using (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
  );
