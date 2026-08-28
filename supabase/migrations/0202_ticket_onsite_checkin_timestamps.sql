-- On-Site Check-In timestamps, straight on the ticket row.
--
-- MobileTechApp.tsx's On-Site Check-In card already logs "I'm Here"/"I'm
-- Done" as free-text ticket comments (addTicketComment), but that's not
-- reliable structured data to gate anything on: no clean way to tell "did
-- THIS technician check in TODAY" from a comment thread that can span many
-- visits over time. These two columns are the real signal, set directly by
-- the same button taps.
--
-- Read by:
--  - technicianWhereabouts.ts's getTechnicianWhereabouts(): a ticket only
--    counts as "current"/"At job now" once onsite_arrived_at is set and
--    onsite_done_at isn't yet — previously any open ticket scheduled today
--    counted, regardless of whether the technician had actually arrived.
--  - getTechnicianTodayRoute(): surfaces both timestamps per stop for the
--    "Timestamp (Start - End)" row in TechnicianDayRouteModal.tsx.
--
-- Written by: MobileTechApp.tsx's handleImHere/handleImDone, alongside the
-- existing comment log (kept for its audit-trail visibility on the ticket
-- itself — this migration doesn't touch that).
--
-- Reset (nulled) by updateTicketAssignment() whenever a ticket's technician
-- or schedule_date changes — a reassignment or reschedule invalidates any
-- prior physical check-in; carrying it forward would misreport a technician
-- as "at" a job they haven't actually been dispatched to (yet, or anymore).

alter table tickets add column if not exists onsite_arrived_at timestamptz;
alter table tickets add column if not exists onsite_done_at timestamptz;
