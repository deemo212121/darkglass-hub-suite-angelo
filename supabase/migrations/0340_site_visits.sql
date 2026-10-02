-- =====================================================================
-- 0340 — Site visitors: every page open on adminhubsolution.com, signed
-- in or not.
--
-- login_events (0089) only records IPs at sign-in. This logs the visitor's
-- IP + Cloudflare geolocation for page opens too, so someone who opens the
-- site without logging in is still visible. Written server-side only by
-- src/lib/server/siteVisitLog.ts (service role, which bypasses RLS) —
-- pages only, never /api/* or /assets/*, and the same IP + page is only
-- logged once every few minutes.
--
-- Not company-scoped: an anonymous visitor belongs to no company. Readable
-- by Admin / SuperAdmin only (Login Security → Site Visitors).
--
-- New table only — no existing data is touched.
-- Run once in the Supabase SQL Editor, after 0339.
-- =====================================================================

create table if not exists site_visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ip text,
  country text,
  region text,
  city text,
  latitude double precision,
  longitude double precision,
  -- the visitor's network (ISP / mobile carrier / VPN provider)
  asn integer,
  as_org text,
  host text,
  path text,
  referer text,
  user_agent text,
  browser text,
  device text
);

create index if not exists site_visits_created_at_idx on site_visits (created_at desc);
create index if not exists site_visits_ip_idx on site_visits (ip);

alter table site_visits enable row level security;

-- No insert/update/delete policy: only the server writes this table.
drop policy if exists site_visits_select on site_visits;
create policy site_visits_select on site_visits
  for select using (is_admin() or is_superadmin());
