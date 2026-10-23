-- =====================================================================
-- 0406 — Distributor credits on Part Transaction rows.
--
-- The hourly job (src/lib/server/partCreditSync.ts) checks Marcone's
-- return authorizations (and Encompass return lines, once encompass.com
-- stops blocking the Worker) and, when a returned part has been credited,
-- fills parts.credit_no with the credit memo (only when empty — a Credit #
-- typed by hand is never overwritten) and records it here so the ticket's
-- Part Transaction shows a "Credited" badge:
--
--   credited_at           when AHS found the credit
--   credit_source         'Marcone' | 'Encompass' (null = typed by hand)
--   return_reject_reason  the distributor rejected the return (Marcone's reason)
--   credit_checked_at     last time the job checked this part (Encompass is
--                         checked one return at a time, so it's paced)
--
-- New nullable columns only — no data is touched. Existing parts policies
-- already cover them. Run once in the Supabase SQL Editor, after 0405.
-- =====================================================================

alter table parts add column if not exists credited_at timestamptz;
alter table parts add column if not exists credit_source text;
alter table parts add column if not exists return_reject_reason text;
alter table parts add column if not exists credit_checked_at timestamptz;
