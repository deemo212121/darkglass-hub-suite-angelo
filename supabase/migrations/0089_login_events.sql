-- =====================================================================
-- 0089_login_events.sql
--
-- Per-login history — one row every time a user signs in or their
-- session silently refreshes (see supabaseTokenBridge.ts, the only
-- server-side point in the login flow, where the real client IP is
-- available via Cloudflare's CF-Connecting-IP header and geolocation via
-- request.cf). Powers the admin "Login Security" page: last/most-used IP
-- per user, browser/device, and flagging a login from a very different
-- location than the user's own recent history, or the same IP shared by
-- two different employees.
--
-- This is deliberately an ever-growing log (unlike profiles.last_login /
-- last_login_ip, which just overwrite the most recent value) — a
-- retention/cleanup policy can be added later if it gets large.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists login_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  ip text,
  country text,
  region text,
  city text,
  latitude double precision,
  longitude double precision,
  user_agent text,
  browser text,
  device text,
  created_at timestamptz not null default now()
);

create index if not exists login_events_profile_id_created_at_idx on login_events (profile_id, created_at desc);
create index if not exists login_events_company_id_idx on login_events (company_id);
create index if not exists login_events_ip_idx on login_events (ip);

alter table login_events enable row level security;

-- Parallels is_superadmin() (0001_init.sql) — same SECURITY DEFINER
-- pattern so the policy below doesn't recurse into profiles' own RLS.
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (role = 'ADMIN' or 'ADMIN' = any(extra_roles))
  );
$$;

-- Login IPs/locations are security-sensitive — only Admin/SuperAdmin for
-- the user's own company can read them, not every signed-in user (unlike
-- most company-scoped tables in this app, which any company member can
-- read). No insert/update/delete policy: only the server (service role,
-- which bypasses RLS) ever writes this table.
create policy login_events_select on login_events
  for select using (company_id = auth_company_id() and (is_admin() or is_superadmin()));
