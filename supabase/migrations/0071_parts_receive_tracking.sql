-- =====================================================================
-- 0071 — Part Receive: real receiving tracking on parts
--
-- The Part Receive page was 100% mock data (4 hardcoded rows, not even
-- persisted to localStorage - edits vanished on refresh). Real parts
-- already carry po_no/po_date/order_no/eta/in_tracking/part_dist once a
-- PO has been placed (status = 'PO Made'; confirmed against production:
-- 56 real parts currently in this state) - but nothing tracks how much
-- of the order has actually been received or when, so this adds that.
--
-- Deliberately does NOT change `status` when a part is received - same
-- "own independent flag, not a status transition" pattern as 0069's
-- picked_up column.
--
-- Run once in the Supabase SQL Editor, after 0070.
-- =====================================================================

alter table parts
  add column qty_received numeric(10,2) not null default 0,
  add column received_date date;
