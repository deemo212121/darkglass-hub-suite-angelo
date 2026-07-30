-- =====================================================================
-- 0079 — "Set notifications": lets a form's admin pick specific company
-- accounts to notify on submission, instead of always notifying every
-- HR/Admin/Manager account (see findHrFirebaseUids in
-- src/lib/server/customFormsBridge.ts).
--
-- notify_firebase_uids stores the picked accounts' Firebase uids (what
-- notifications are actually keyed by — see the `notifications/{uid}/items`
-- Firestore path written in customFormsBridge.ts), as a plain text array
-- rather than a new join table since this is a small, unordered set with no
-- extra per-row metadata. NULL/empty means "no explicit picks" — the
-- existing default behavior (notify every HR/Admin/Manager account)
-- applies unchanged; this column only narrows that down when populated.
--
-- Run once in the Supabase SQL Editor, after 0077/0078.
-- =====================================================================

alter table hr_custom_forms add column if not exists notify_firebase_uids text[];
