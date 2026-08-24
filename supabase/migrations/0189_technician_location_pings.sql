-- =====================================================================
-- 0189 — Real GPS location tracking for technicians, gated on clock-in
-- status and a signed Location Consent document.
--
-- One row per technician, overwritten on every ping (latest position
-- only — no day-long breadcrumb trail, to keep the privacy footprint
-- minimal). "technician_locations" was already taken by an unrelated
-- technician<->branch-location junction table (see 0001_init.sql), so
-- this is named technician_location_pings instead.
--
-- RLS follows the exact precedent already set for other sensitive
-- per-user location data in login_events (0089_login_events.sql):
-- reads are restricted to Admin/SuperAdmin for the company, reusing the
-- already-defined is_admin()/is_superadmin()/auth_company_id()/
-- auth_profile_id() helpers — no new helper functions needed.
--
-- Writes (insert/update) are restricted to the technician's own row AND
-- only permitted while they have a genuinely open shift in
-- timecard_entries (check_in set, check_out not set) — this is the
-- database itself enforcing the "we will not track outside active
-- working hours" promise made in the signed Location Consent agreement
-- (src/assets/EMPLOYEE MOBILE APP LOCATION SHARING CONSENT AGREEMENT.pdf),
-- not just something trusted from client-side JS. The 20-hour bound in
-- that check is a sanity cap against a long-forgotten-open shift, not a
-- calendar-day check — current_date would be UTC and could disagree
-- with the technician's own local "today" right around midnight.
--
-- Deletes are allowed for the technician's own row too, so the client
-- can actively clear it the moment they clock out (real off-hours
-- privacy — not just leaving a stale pin lying around until it ages
-- out on the read side).
--
-- Run once in the Supabase SQL Editor, after 0188.
-- =====================================================================

create table if not exists technician_location_pings (
  profile_id   uuid primary key references profiles(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  accuracy_m   double precision,
  recorded_at  timestamptz not null,
  updated_at   timestamptz not null default now()
);

create index if not exists idx_technician_location_pings_company on technician_location_pings(company_id);

alter table technician_location_pings enable row level security;
alter table technician_location_pings force row level security;

drop policy if exists technician_location_pings_select on technician_location_pings;
create policy technician_location_pings_select on technician_location_pings
  for select using (company_id = auth_company_id() and (is_admin() or is_superadmin()));

drop policy if exists technician_location_pings_insert on technician_location_pings;
create policy technician_location_pings_insert on technician_location_pings
  for insert with check (
    profile_id = auth_profile_id()
    and company_id = auth_company_id()
    and exists (
      select 1 from timecard_entries te
      where te.profile_id = technician_location_pings.profile_id
        and te.check_in is not null and te.check_in <> ''
        and (te.check_out is null or te.check_out = '')
        and te.updated_at > now() - interval '20 hours'
    )
  );

drop policy if exists technician_location_pings_update on technician_location_pings;
create policy technician_location_pings_update on technician_location_pings
  for update using (profile_id = auth_profile_id())
  with check (
    profile_id = auth_profile_id()
    and company_id = auth_company_id()
    and exists (
      select 1 from timecard_entries te
      where te.profile_id = technician_location_pings.profile_id
        and te.check_in is not null and te.check_in <> ''
        and (te.check_out is null or te.check_out = '')
        and te.updated_at > now() - interval '20 hours'
    )
  );

drop policy if exists technician_location_pings_delete on technician_location_pings;
create policy technician_location_pings_delete on technician_location_pings
  for delete using (profile_id = auth_profile_id() or is_admin() or is_superadmin());
