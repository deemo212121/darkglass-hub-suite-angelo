-- =====================================================================
-- 0349 — Missed Time Out not corrected in time → correction meeting.
--
-- Extends clock_in_meetings (0348) with a `kind`:
--   'missed_clock_in'  — scheduled work day with no Time In (0348)
--   'missed_time_out'  — the technician didn't press Time Out (the day was
--                        closed by an automatic clock-out: midnight force
--                        clock-out or arrived-home geofence) AND no Time
--                        Correction request for that day was submitted
--                        before their next Time In (or by the end of their
--                        next work day if they didn't clock in).
-- Both kinds are 1 error on the Technician Performance Report and need a
-- correction meeting. Rows are written only by the Worker's hourly job.
--
-- Existing rows become 'missed_clock_in'. No other data is changed.
-- Run once in the Supabase SQL Editor, after 0348.
-- =====================================================================

alter table clock_in_meetings
  add column if not exists kind text not null default 'missed_clock_in';

alter table clock_in_meetings drop constraint if exists clock_in_meetings_kind_check;
alter table clock_in_meetings
  add constraint clock_in_meetings_kind_check check (kind in ('missed_clock_in', 'missed_time_out'));

-- One row per technician, day AND kind (a day can have both).
alter table clock_in_meetings drop constraint if exists clock_in_meetings_profile_id_missed_date_key;
create unique index if not exists clock_in_meetings_profile_date_kind_key
  on clock_in_meetings (profile_id, missed_date, kind);
