-- =====================================================================
-- 0080 — "Connect Google Drive": stores one Google OAuth refresh token
-- per company, so every submission on a form with a Document Template can
-- be auto-uploaded as a PDF into the company's own Drive (see
-- src/lib/server/googleDriveBridge.ts).
--
-- Deliberately its OWN table, NOT a new key inside companies.settings
-- (unlike the mapProvider/coeBodyTemplate settings in 0053/0058) — that
-- jsonb column is readable by every authenticated user in the company via
-- the existing companies_select policy, and a Drive refresh token must
-- never be readable by anyone but the server. This table has RLS enabled
-- AND forced with NO policies at all, so only the service-role key (used
-- exclusively by the server-side bridge, never the browser client) can
-- touch it — regular users only ever interact with it indirectly through
-- the two RPCs below, which expose just a connected/not-connected status,
-- never the token itself.
--
-- Run once in the Supabase SQL Editor, after 0079.
-- =====================================================================

create table if not exists hr_google_drive_connections (
  company_id uuid primary key references companies(id) on delete cascade,
  connected_by uuid references profiles(id) on delete set null,
  connected_by_name text,
  refresh_token text not null,
  -- Cached once the "File Submissions" root folder is first created, so
  -- every later upload doesn't need its own Drive search-or-create round trip.
  root_folder_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table hr_google_drive_connections enable row level security;
alter table hr_google_drive_connections force row level security;

create or replace function hr_google_drive_connections_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_google_drive_connections_touch on hr_google_drive_connections;
create trigger trg_google_drive_connections_touch
  before update on hr_google_drive_connections
  for each row execute function hr_google_drive_connections_touch_updated_at();

-- Safe to expose to any authenticated user in the company — connected
-- status and who connected it, never the refresh_token itself.
create or replace function get_google_drive_connection_status()
returns table(connected boolean, connected_by_name text, connected_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  return query
    select true, c.connected_by_name, c.created_at
    from hr_google_drive_connections c
    where c.company_id = v_company_id
  union all
    select false, null::text, null::timestamptz
    where not exists (select 1 from hr_google_drive_connections where company_id = v_company_id)
  limit 1;
end;
$$;

create or replace function disconnect_google_drive()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN') then
    raise exception 'Only an Admin can disconnect Google Drive';
  end if;

  delete from hr_google_drive_connections where company_id = v_company_id;
end;
$$;
