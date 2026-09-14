-- =====================================================================
-- 0257 — Flash Tech trip tracker fields
--
-- Extends flash_tech_trips (0129) with the columns HR/Accounting's actual
-- trip-tracking spreadsheet uses, beyond what the Schedule Trip calendar
-- captures (technician/origin/destination/dates/notes already exist):
--   tier_level                    — free-typed dropdown (Tier 1/2/3, BM,
--                                    SBM, A. Director, Director)
--   lodging_start_date/end_date   — hotel stay dates, independent of the
--                                    trip's own travel dates
--   hotel_name/address/rate/confirmation
--   rental_car/rental_start_date/rental_end_date/rental_rate/vehicle_type
--   other_expenses
--   sbm_confirmed (+ by/by_name)  — a checkbox, stamped with who checked it
--   receipt_path                  — single attachment, same Firebase
--                                    Storage pattern as attendance_notes'
--                                    attachment_path (see 0244)
--   trip_type                     — Flashtech / Education / Inspection
--   status                        — Open / Closed / Pending
--
-- Every trip the existing calendar already creates gets these columns
-- available immediately (no backfill needed — all nullable or sensibly
-- defaulted). RLS: widens the existing update policy to also let HR fill
-- these in, not just Admin/Finance/SuperAdmin — the tracker is meant to be
-- worked from both the Accounting and HR Dashboards, same as Employee
-- Monitoring/absent-list already is. is_hr() already exists (0150).
--
-- Run once in the Supabase SQL Editor, after 0256.
-- =====================================================================

alter table flash_tech_trips add column if not exists tier_level text;
alter table flash_tech_trips add column if not exists lodging_start_date date;
alter table flash_tech_trips add column if not exists lodging_end_date date;
alter table flash_tech_trips add column if not exists hotel_name text;
alter table flash_tech_trips add column if not exists hotel_address text;
alter table flash_tech_trips add column if not exists hotel_rate numeric;
alter table flash_tech_trips add column if not exists hotel_confirmation text;
alter table flash_tech_trips add column if not exists rental_car text;
alter table flash_tech_trips add column if not exists rental_start_date date;
alter table flash_tech_trips add column if not exists rental_end_date date;
alter table flash_tech_trips add column if not exists rental_rate numeric;
alter table flash_tech_trips add column if not exists vehicle_type text;
alter table flash_tech_trips add column if not exists other_expenses numeric;
alter table flash_tech_trips add column if not exists sbm_confirmed boolean not null default false;
alter table flash_tech_trips add column if not exists sbm_confirmed_by uuid references profiles(id) on delete set null;
alter table flash_tech_trips add column if not exists sbm_confirmed_by_name text;
alter table flash_tech_trips add column if not exists receipt_path text;
alter table flash_tech_trips add column if not exists trip_type text not null default 'Flashtech';
alter table flash_tech_trips add column if not exists status text not null default 'Open';

alter table flash_tech_trips drop constraint if exists flash_tech_trips_trip_type_check;
alter table flash_tech_trips add constraint flash_tech_trips_trip_type_check
  check (trip_type in ('Flashtech', 'Education', 'Inspection'));

alter table flash_tech_trips drop constraint if exists flash_tech_trips_status_check;
alter table flash_tech_trips add constraint flash_tech_trips_status_check
  check (status in ('Open', 'Closed', 'Pending'));

-- Widen update access to include HR (was Admin/Finance/SuperAdmin only —
-- scheduling/deleting a trip stays that narrower set, only UPDATE opens up).
drop policy if exists flash_tech_trips_update on flash_tech_trips;
create policy flash_tech_trips_update on flash_tech_trips
  for update using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_hr() or is_superadmin())
  )
  with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_hr() or is_superadmin())
  );
