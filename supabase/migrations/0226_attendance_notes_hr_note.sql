-- Second, separate free-text slot on attendance_notes — the existing
-- `content` column is the general/manager-facing note (shown on Ticket
-- Attendance's Notes column and Absent List's Note column); `hr_note` is
-- HR's own commentary on the same (profile, day), kept distinct so one
-- audience's note never overwrites the other's. Same row, same unique
-- (profile_id, note_date) constraint — just a second column.
alter table attendance_notes add column if not exists hr_note text;

-- upsertAttendanceHrNote (attendanceNotes.ts) writes ONLY {profile_id,
-- note_date, hr_note} on every save — never touching `content` — so an
-- HR-note save can never clobber an existing manager/general note (and
-- vice versa, the existing upsertAttendanceNote never touches hr_note).
-- That only works for a brand-new (profile, day) row if `content` doesn't
-- require a value the HR-only insert isn't providing.
alter table attendance_notes alter column content set default '';
alter table attendance_notes alter column content drop not null;
update attendance_notes set content = '' where content is null;
