-- =====================================================================
-- 0027 — Link pto_requests + attendance_notes to profiles
--
-- Both tables were defined in 0001_init.sql against `employees`, but (same
-- situation as timecard_entries before 0015) the `employees` table is never
-- populated by the app — real users live in `profiles`. This adds a
-- profile_id column to each so the Attendance Monitoring dashboard can read
-- and write real PTO requests / attendance notes against actual users.
--
-- employee_id is relaxed to nullable (mirrors timecard_entries, which was
-- already nullable) since new rows will be written through profile_id only.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table pto_requests alter column employee_id drop not null;
alter table pto_requests add column if not exists profile_id uuid references profiles(id) on delete cascade;
create index if not exists idx_pto_requests_profile on pto_requests(profile_id);

alter table attendance_notes add column if not exists profile_id uuid references profiles(id) on delete cascade;
create index if not exists idx_attendance_notes_profile on attendance_notes(profile_id, note_date);

-- One note per (profile, day) so the "Add/Edit Note" modal can upsert
-- instead of accumulating duplicate rows every save.
create unique index if not exists ux_attendance_notes_profile_date
  on attendance_notes (profile_id, note_date)
  where profile_id is not null;
