-- =====================================================================
-- 0175 — Split parts_done_activity_log's flat `summary` text into
-- structured per-metric columns (Collections/Pickup/Received done vs
-- total), so the Done Activity tab can render them as real bullet points
-- with per-metric color coding instead of parsing a formatted sentence.
--
-- Nullable so existing rows (logged before this migration, `summary`-
-- only) keep displaying via that fallback — see partsDoneActivityLog.ts.
--
-- Run once in the Supabase SQL Editor, after 0174.
-- =====================================================================

alter table parts_done_activity_log add column if not exists collections_done int;
alter table parts_done_activity_log add column if not exists collections_total int;
alter table parts_done_activity_log add column if not exists pickup_done int;
alter table parts_done_activity_log add column if not exists pickup_total int;
alter table parts_done_activity_log add column if not exists received_done int;
alter table parts_done_activity_log add column if not exists received_total int;
