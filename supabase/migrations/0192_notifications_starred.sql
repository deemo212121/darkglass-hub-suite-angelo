-- =====================================================================
-- 0192 — Gmail-style starring for bell notifications (migration 0035).
--
-- Renumbered from upstream's 0189 (deemo212121/darkglass-hub-suite-angelo)
-- to avoid colliding with this repo's own 0189_technician_location_pings —
-- both branched from the same 0188 base. Already applied to the shared
-- Supabase project under its original number; this file exists purely so
-- this repo's migration history has a record of it at the right position.
--
-- A simple boolean flag so a recipient can flag a notification to come
-- back to later, independent of read/unread state — same convention as
-- Gmail's star, not tied to any workflow/approval status. RLS already
-- scopes all access on this table to the recipient (or superadmin, see
-- 0035's notifications_select/update policies), so no new policy is
-- needed — starring is just another column those same policies cover.
--
-- Run once in the Supabase SQL Editor, after 0191 (already applied live).
-- =====================================================================

alter table notifications add column if not exists starred boolean not null default false;
