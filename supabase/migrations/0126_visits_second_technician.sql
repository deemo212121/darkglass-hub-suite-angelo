-- =====================================================================
-- 0126 — visits.second_technician
--
-- Optional assisting technician on a "Two Tech" job, set from the visit
-- editor on ticket.$ticketNo.tsx right next to the existing (primary)
-- Technician field. Free-text, same convention as visits.technician
-- itself (matched against real names client-side, not a foreign key) —
-- feeds Tech Payroll's per-visit "Two Tech" auto-count (see
-- getTechSecondCounts in techPayroll.ts), distinct from the "2 Man Job"
-- repair_type which describes the JOB, not who else worked it.
--
-- Run once in the Supabase SQL Editor, after 0125.
-- =====================================================================

alter table visits add column if not exists second_technician text;
