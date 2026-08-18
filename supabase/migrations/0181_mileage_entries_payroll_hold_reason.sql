-- =====================================================================
-- 0181 — Distinguish WHY a mileage_entries row is payroll_excluded: a
-- human manually put it on hold (via Mileage tab's On Hold button), or
-- the automatic "no photos uploaded yet" rule did. Both still write the
-- same payroll_excluded boolean getTechCompletedRepairCounts already
-- reads — no changes needed there — this column just lets the automatic
-- rule know never to touch (override or clear) a manual hold, and lets
-- a human's "take it off hold" always win even if there's still no
-- photo.
--
-- Run once in the Supabase SQL Editor, after 0180.
-- =====================================================================

alter table mileage_entries add column if not exists payroll_hold_reason text
  check (payroll_hold_reason in ('manual', 'no_photos'));
