-- =====================================================================
-- Additional profile fields surfaced on the User Details "General
-- Information" tab.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table profiles add column if not exists email_report_location text;
alter table profiles add column if not exists sms_status text default 'Not available';
alter table profiles add column if not exists off_days int[] default '{}';
-- (manager_name, assigned_branch, po_initials, phone_number already exist)
