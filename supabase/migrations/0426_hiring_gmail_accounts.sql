-- =====================================================================
-- 0426 — Hiring: each HR person connects their own Gmail
--
-- hr_gmail_connections allows one account per slot, so the Hiring panel
-- could only ever have one mailbox. This table holds as many as people
-- connect. HR, Admin and Super Admin can each connect their own; when
-- sending a candidate email or login credentials they pick From:
--   - an account they connected themselves, or
--   - one its owner (or an Admin) marked "shared with HR".
-- gmailBridge.ts enforces that on every send.
--
-- Everyone in those three roles can see the list. An Admin / Super Admin
-- can disconnect or share any account; anyone else only their own.
-- Refresh tokens are never returned: RLS is on with no policies, so only
-- the server (service key) and the functions below can touch this table,
-- and the functions don't return the token.
--
-- If the old single Hiring Gmail is connected when this runs, it's copied
-- in as shared, since everyone was using it already.
--
-- New table only — no existing data is changed. Safe to rerun.
-- Run once in the Supabase SQL Editor, after 0425.
-- =====================================================================

create table if not exists hiring_gmail_accounts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  connected_by           uuid references profiles(id) on delete set null,
  connected_by_name      text,
  connected_account_name text,
  connected_email        text not null,
  refresh_token          text not null,
  shared                 boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, connected_email)
);

alter table hiring_gmail_accounts enable row level security;
alter table hiring_gmail_accounts force row level security;

drop trigger if exists trg_hiring_gmail_accounts_touch on hiring_gmail_accounts;
create trigger trg_hiring_gmail_accounts_touch
  before update on hiring_gmail_accounts
  for each row execute function hr_gmail_connections_touch_updated_at();

insert into hiring_gmail_accounts (company_id, connected_by, connected_by_name, connected_account_name, connected_email, refresh_token, shared)
select c.company_id, c.connected_by, c.connected_by_name, c.connected_account_name, lower(c.connected_email), c.refresh_token, true
from hr_gmail_connections c
where c.region = 'HR_HIRING' and c.connected_email is not null
on conflict (company_id, connected_email) do nothing;

-- Who's calling, and what they may do. No row for someone with no profile.
create or replace function hiring_gmail_caller()
returns table(company_id uuid, profile_id uuid, can_use boolean, can_manage_all boolean)
language sql stable security definer set search_path = public as $$
  select
    p.company_id,
    p.id,
    exists (select 1 from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) r where upper(r) in ('HR', 'ADMIN', 'SUPERADMIN')),
    exists (select 1 from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) r where upper(r) in ('ADMIN', 'SUPERADMIN'))
  from profiles p
  where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    and coalesce(p.is_active, true)
  limit 1;
$$;

create or replace function get_hiring_gmail_accounts()
returns table(
  id uuid,
  connected_email text,
  connected_account_name text,
  connected_by_name text,
  shared boolean,
  created_at timestamptz,
  mine boolean
)
language sql stable security definer set search_path = public as $$
  select
    a.id,
    a.connected_email,
    a.connected_account_name,
    a.connected_by_name,
    a.shared,
    a.created_at,
    coalesce(a.connected_by = c.profile_id, false)
  from hiring_gmail_accounts a
  join hiring_gmail_caller() c on c.company_id = a.company_id
  where c.can_use
  order by a.connected_email;
$$;

create or replace function disconnect_hiring_gmail(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
begin
  select * into v_caller from hiring_gmail_caller();
  if v_caller.company_id is null or not v_caller.can_use then
    raise exception 'You do not have permission to disconnect this Gmail';
  end if;

  delete from hiring_gmail_accounts a
  where a.id = p_id
    and a.company_id = v_caller.company_id
    and (a.connected_by = v_caller.profile_id or v_caller.can_manage_all);
  if not found then
    raise exception 'You can only disconnect your own Gmail';
  end if;
end;
$$;

create or replace function set_hiring_gmail_shared(p_id uuid, p_shared boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
begin
  select * into v_caller from hiring_gmail_caller();
  if v_caller.company_id is null or not v_caller.can_use then
    raise exception 'You do not have permission to change this Gmail';
  end if;

  update hiring_gmail_accounts a
  set shared = p_shared
  where a.id = p_id
    and a.company_id = v_caller.company_id
    and (a.connected_by = v_caller.profile_id or v_caller.can_manage_all);
  if not found then
    raise exception 'You can only share your own Gmail';
  end if;
end;
$$;

notify pgrst, 'reload schema';
