-- =====================================================================
-- 0082 — Per-form on/off switch for the Google Drive auto-upload
--
-- Until now, a form with a Document Template always uploaded every
-- submission's PDF to Drive (once the company connected an account) —
-- see uploadSubmissionToDriveIfConfigured. This adds an explicit toggle
-- so HR can turn that off per form without removing the template itself
-- (e.g. a form still wants a printable PDF, just not filed to Drive).
--
-- Defaults to true so existing forms with a Document Template keep
-- uploading exactly as before until someone explicitly flips it off.
--
-- Run once in the Supabase SQL Editor, after 0081.
-- =====================================================================

alter table hr_custom_forms add column if not exists drive_upload_enabled boolean not null default true;
