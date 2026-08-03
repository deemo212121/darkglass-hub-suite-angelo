-- =====================================================================
-- 0113 — "Connect Gmail": stores one Google OAuth refresh token PER
-- REGION per company (US and PH are separate payroll currencies/teams —
-- see AccountingDashboard.tsx's US/PH Payroll toggle — so each gets its
-- own connected Gmail account) so Payroll can send payslip emails from
-- the right connected account. See src/lib/server/gmailBridge.ts.
--
-- Same shape as hr_google_drive_connections (0080): its OWN table, NOT a
-- key inside companies.settings — that jsonb is readable by every
-- authenticated company user, and a Gmail refresh token must never be
-- readable by anyone but the server. RLS enabled AND forced with NO
-- policies, so only the service-role key (the server-side bridge, never
-- the browser) can touch it — regular users only see connected/not via
-- get_gmail_connection_status(p_region), never the token.
--
-- Run once in the Supabase SQL Editor, after 0112.
-- =====================================================================

create table if not exists hr_gmail_connections (
  company_id uuid not null references companies(id) on delete cascade,
  region text not null check (region in ('US', 'PH')),
  connected_by uuid references profiles(id) on delete set null,
  -- Whoever clicked "Connect Gmail" (an AHS admin) — may be a DIFFERENT
  -- person than the Google account itself, e.g. an IT admin connecting a
  -- shared "Payroll US" mailbox on the team's behalf.
  connected_by_name text,
  -- The connected Google ACCOUNT's own name + address (from Google's
  -- userinfo endpoint at connect time, profile+email scopes) — this is
  -- what payslip recipients will actually see as the sender.
  connected_account_name text,
  connected_email text,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, region)
);

alter table hr_gmail_connections enable row level security;
alter table hr_gmail_connections force row level security;

create or replace function hr_gmail_connections_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_gmail_connections_touch on hr_gmail_connections;
create trigger trg_gmail_connections_touch
  before update on hr_gmail_connections
  for each row execute function hr_gmail_connections_touch_updated_at();

-- Safe to expose to any authenticated user in the company — connected
-- status, who connected it, the connected account's own name, and its
-- address, never the token.
create or replace function get_gmail_connection_status(p_region text)
returns table(connected boolean, connected_by_name text, connected_account_name text, connected_email text, connected_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_region text := upper(coalesce(p_region, ''));
begin
  select company_id into v_company_id
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  return query
    select true, c.connected_by_name, c.connected_account_name, c.connected_email, c.created_at
    from hr_gmail_connections c
    where c.company_id = v_company_id and c.region = v_region
  union all
    select false, null::text, null::text, null::text, null::timestamptz
    where not exists (select 1 from hr_gmail_connections where company_id = v_company_id and region = v_region)
  limit 1;
end;
$$;

create or replace function disconnect_gmail(p_region text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
  v_region text := upper(coalesce(p_region, ''));
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN') then
    raise exception 'Only an Admin can disconnect Gmail';
  end if;

  delete from hr_gmail_connections where company_id = v_company_id and region = v_region;
end;
$$;
