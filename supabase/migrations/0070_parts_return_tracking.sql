-- =====================================================================
-- 0070 — Part Return Status: real return-shipment tracking on parts
--
-- The Part Return Status page was 100% mock data (23 hardcoded rows,
-- persisted only to localStorage, never touching Supabase). Real parts
-- already carry ra_no/ra_date/core_value (added in 0001) and one of four
-- real "RA - *" statuses (RA - Defect, RA- DMG, RA - PNN,
-- RA - Qty Discrepancy) once a part is flagged for return - but nothing
-- tracks the *return shipment's own* lifecycle (has the distributor
-- received it back, processed the credit, etc.) or who handled it.
-- That's what this migration adds.
--
-- Run once in the Supabase SQL Editor, after 0069.
-- =====================================================================

alter table parts
  add column return_status text not null default 'NOT RECEIVED',
  add column returned_by text;
