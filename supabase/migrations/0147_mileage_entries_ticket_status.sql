-- =====================================================================
-- 0147 — Ticket status on mileage entries
--
-- Denormalized snapshot of the originating ticket's status at sync time —
-- same convention as ticket_no (migration 0143) and technician_name
-- (migration 0142). Now that syncing pulls every assigned ticket rather
-- than completed-only (see mileage.ts), the status is worth showing per
-- row so it's obvious at a glance which entries are for jobs that are
-- still open/in progress vs actually done. A snapshot, not live — if the
-- ticket's status changes later, the mileage row still shows whatever it
-- was at sync time, same as address/contact/email already do.
--
-- Backfills every already-synced row too, same reasoning as 0143's
-- ticket_no backfill: a future sync run never revisits an already-synced
-- ticket_id, so re-running Sync alone can't fill these in.
--
-- Run once in the Supabase SQL Editor, after 0146.
-- =====================================================================

alter table mileage_entries add column if not exists ticket_status text;

update mileage_entries me
set ticket_status = t.status
from tickets t
where me.ticket_id = t.id
  and me.ticket_status is null;
