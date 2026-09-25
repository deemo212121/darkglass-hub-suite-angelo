-- Generate EOD/EOM Hiring Report's "Call Attempt" column (0308/0309) only
-- ever auto-counts REAL rows in hr_candidate_attempts — which means every
-- period before that table existed (today) reads 0, with no way to
-- backfill what actually happened on those earlier days. This adds a
-- manual override, same as Budget/Sponsored/Others already have (0278) —
-- typed into hr_hiring_report_manual_entries per (period, section, row).
-- When set (non-null), it WINS over the auto-count for that cell; leaving
-- it blank falls back to the real hr_candidate_attempts count, which is
-- already accurate for today onward via the Hiring tab's "Log Attempt"
-- button.
--
-- Run once in the Supabase SQL Editor, after 0309.

alter table hr_hiring_report_manual_entries add column if not exists call_attempt numeric;
