-- =====================================================================
-- 0189 — Gmail-style starring for bell notifications (migration 0035).
--
-- A simple boolean flag so a recipient can flag a notification to come
-- back to later, independent of read/unread state — same convention as
-- Gmail's star, not tied to any workflow/approval status. RLS already
-- scopes all access on this table to the recipient (or superadmin, see
-- 0035's notifications_select/update policies), so no new policy is
-- needed — starring is just another column those same policies cover.
--
-- Run once in the Supabase SQL Editor, after 0188.
-- =====================================================================

alter table notifications add column if not exists starred boolean not null default false;
