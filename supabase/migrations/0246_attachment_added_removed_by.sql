-- Tracks who attached / removed a PTO or attendance-note attachment, and
-- when — surfaced as "Added by" / "Removed by" next to the attachment
-- controls on the Time Off Calendar and Absent List. Removed-by columns
-- are kept even after attachment_path is cleared, so "Removed by X" can
-- still show once there's no longer a file to view.

alter table pto_requests add column if not exists attachment_added_by uuid references profiles(id);
alter table pto_requests add column if not exists attachment_added_at timestamptz;
alter table pto_requests add column if not exists attachment_removed_by uuid references profiles(id);
alter table pto_requests add column if not exists attachment_removed_at timestamptz;

alter table attendance_notes add column if not exists attachment_added_by uuid references profiles(id);
alter table attendance_notes add column if not exists attachment_added_at timestamptz;
alter table attendance_notes add column if not exists attachment_removed_by uuid references profiles(id);
alter table attendance_notes add column if not exists attachment_removed_at timestamptz;
