-- Photo/file attachment on an attendance note (e.g. a doctor's note backing
-- up an HR Status set on Absent List) — reuses the existing private
-- "pto-attachments" bucket + its company-scoped RLS policies
-- (0240_pto_requests_attachment.sql) rather than creating a new bucket;
-- the path's leading `{company_id}/` segment is all those policies check.

alter table attendance_notes add column if not exists attachment_path text;
