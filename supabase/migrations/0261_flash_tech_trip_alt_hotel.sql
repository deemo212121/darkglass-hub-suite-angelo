-- =====================================================================
-- 0261 — Flash Tech trip alternate hotel
--
-- A technician sometimes asks to switch hotels mid-trip (the originally
-- booked one falls through, they want somewhere closer, etc.) without
-- replacing the original Hotel Name/Lodging Date/Address/Rate/Confirmation
-- columns from 0257 — those stay as the record of what was first booked.
-- alt_hotel_requested is the Tracker's "Technician requested another
-- hotel" toggle; when set it reveals a second small set of fields for the
-- replacement stay. All nullable/defaulted — no backfill needed.
--
-- Run once in the Supabase SQL Editor, after 0260.
-- =====================================================================

alter table flash_tech_trips add column if not exists alt_hotel_requested boolean not null default false;
alter table flash_tech_trips add column if not exists alt_lodging_start_date date;
alter table flash_tech_trips add column if not exists alt_lodging_end_date date;
alter table flash_tech_trips add column if not exists alt_hotel_address text;
alter table flash_tech_trips add column if not exists alt_hotel_rate numeric;
alter table flash_tech_trips add column if not exists alt_hotel_confirmation text;
