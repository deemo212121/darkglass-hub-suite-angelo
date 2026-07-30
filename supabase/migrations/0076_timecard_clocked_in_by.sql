-- =====================================================================
-- 0076 — Timecard: track who actually performed a clock-in
--
-- Managers (or whoever a technician's manager_name resolves to) can now
-- proxy clock-in their direct-report technicians from Attendance
-- Monitoring (desktop) or the mobile app's "Clock In Team" view. This
-- column records who did it — left null for a normal self-punch, set to
-- the manager's profile id for a proxy punch — so the UI can visibly
-- distinguish "the technician clocked themselves in" from "their manager
-- did it for them." Clock-out is never proxied (no column/flow exists for
-- that), by design — only the technician themselves ends their own shift.
--
-- Run once in the Supabase SQL Editor, after 0075.
-- =====================================================================

alter table timecard_entries
  add column if not exists clocked_in_by uuid references profiles(id) on delete set null;
