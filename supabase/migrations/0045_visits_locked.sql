-- =====================================================================
-- 0045 — Visits: lock a visit once a newer one supersedes it
--
-- When a new visit is logged, the ticket detail page auto-marks whichever
-- visit was previously the latest as "OP-Reschedule Follow up" (see
-- addVisitLogEntry in ticket.$ticketNo.tsx) so only the newest visit's
-- repair status drives the ticket's overall status. `locked` backs the UI
-- guard that stops that superseded visit from being edited afterward,
-- so its auto-set reschedule status (and the rest of its historical
-- record) can't be silently changed once it's no longer the active visit.
-- =====================================================================

alter table visits add column if not exists locked boolean not null default false;
