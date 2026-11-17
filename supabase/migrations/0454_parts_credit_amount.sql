-- =====================================================================
-- 0454 — Part Transaction: how much of a part the distributor credited.
--
-- The hourly credit check (src/lib/server/partCreditSync.ts) now also reads
-- Marcone's order status, whose lines say how many of each part were
-- returned. Marcone only counts a return there once it's credited (a
-- Submitted RA still shows 0), and it covers credits that have no return
-- authorization at all — e.g. a claim's parts credited back to our account
-- (1008819560-10: timer $28.26 + heater $51.34). Recorded per part:
--
--   credit_qty     how many the distributor credited
--   credit_amount  what that came to (credited qty × the price it billed)
--
-- credited_at / credit_source (0406) still mark a part credited; the ticket's
-- Part Transaction shows "Returned 1 · Credit −$28.26" from these.
--
-- New nullable columns only — no data is touched. Existing parts policies
-- already cover them. Run once in the Supabase SQL Editor, after 0453.
-- =====================================================================

alter table parts add column if not exists credit_qty integer;
alter table parts add column if not exists credit_amount numeric(10,2);

notify pgrst, 'reload schema';
