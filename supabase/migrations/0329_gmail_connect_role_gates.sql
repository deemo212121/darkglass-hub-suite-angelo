-- =====================================================================
-- 0329 — Which extra roles may Connect/Disconnect a Gmail slot.
--
-- Admin/SuperAdmin can always connect Gmail (hardcoded, unchanged). This
-- table lets an Admin grant additional roles per slot (region) — e.g. let
-- PARTS_MANAGER connect the Parts/Drop-Ship Gmail from the ticket page's
-- "Connect Gmail" settings gear. Editing a slot replaces its whole role set.
--
-- The connect check itself runs server-side (gmailBridge.ts, service key);
-- disconnect_gmail() below is widened to honour the same grants.
--
-- Run once in the Supabase SQL Editor, after 0328.
-- =====================================================================

create table if not exists gmail_connect_role_gates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  region      text not null,
  role        text not null,
  created_at  timestamptz not null default now(),
  unique (company_id, region, role)
);

create index if not exists idx_gmail_connect_role_gates_company on gmail_connect_role_gates(company_id, region);

create or replace function gmail_connect_role_gates_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gmail_connect_role_gates_stamp on gmail_connect_role_gates;
create trigger trg_gmail_connect_role_gates_stamp before insert on gmail_connect_role_gates
  for each row execute function gmail_connect_role_gates_stamp();

alter table gmail_connect_role_gates enable row level security;
alter table gmail_connect_role_gates force row level security;

drop policy if exists gmail_connect_role_gates_select on gmail_connect_role_gates;
create policy gmail_connect_role_gates_select on gmail_connect_role_gates
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists gmail_connect_role_gates_insert on gmail_connect_role_gates;
create policy gmail_connect_role_gates_insert on gmail_connect_role_gates
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists gmail_connect_role_gates_delete on gmail_connect_role_gates;
create policy gmail_connect_role_gates_delete on gmail_connect_role_gates
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );

-- Disconnect: Admin/SuperAdmin as before, plus any role granted for that slot
-- (primary role or any extra role).
create or replace function disconnect_gmail(p_region text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_roles text[];
  v_region text := upper(coalesce(p_region, ''));
begin
  select company_id, array_append(coalesce(extra_roles, '{}'), role) into v_company_id, v_roles
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_company_id is null then
    raise exception 'Profile not found';
  end if;

  if not exists (select 1 from unnest(v_roles) r where upper(r) in ('ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN'))
     and not exists (
       select 1 from gmail_connect_role_gates g
       where g.company_id = v_company_id and g.region = v_region
         and upper(g.role) in (select upper(r) from unnest(v_roles) r)
     ) then
    raise exception 'You do not have permission to disconnect this Gmail';
  end if;

  delete from hr_gmail_connections where company_id = v_company_id and region = v_region;
end;
$$;
