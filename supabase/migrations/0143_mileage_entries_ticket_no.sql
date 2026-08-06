-- =====================================================================
-- 0143 — Ticket number on mileage entries
--
-- Denormalized snapshot of the originating ticket's human-readable
-- ticket_no (distinct from mileage_entries.ticket_id, the uuid FK) — same
-- convention as technician_name (migration 0142): a display value stored
-- directly on the row so the Mileage tab's table doesn't need to join back
-- to tickets just to show which job an entry came from. Only ever set on
-- auto-synced entries (source: "auto"); manual entries have no ticket at
-- all, so it's left null.
--
-- Backfills every already-synced row too (they predate this column, so
-- ticket_no would otherwise stay null forever — a future sync run never
-- revisits an already-synced ticket_id, so re-running Sync alone can't
-- fill these in).
--
-- Run once in the Supabase SQL Editor, after 0142.
-- =====================================================================

alter table mileage_entries add column if not exists ticket_no text;

update mileage_entries me
set ticket_no = t.ticket_no
from tickets t
where me.ticket_id = t.id
  and me.ticket_no is null;
