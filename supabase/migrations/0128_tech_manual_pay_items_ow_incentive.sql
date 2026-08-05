-- =====================================================================
-- 0128 — tech_manual_pay_items.ow_incentive_pct (backfill)
--
-- 0125 was run against an earlier draft of that file, before OW Incentive
-- was added to it — this brings the live table in line with what 0125
-- looks like in git today, without re-running the whole (CREATE TABLE IF
-- NOT EXISTS-guarded, so a no-op anyway) migration.
--
-- Run once in the Supabase SQL Editor, after 0127.
-- =====================================================================

alter table tech_manual_pay_items
  add column if not exists ow_incentive_pct numeric not null default 0;
