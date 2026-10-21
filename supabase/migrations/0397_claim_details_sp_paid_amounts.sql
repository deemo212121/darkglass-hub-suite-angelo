-- =====================================================================
-- 0397 — What ServicePower paid on a claim, for the Claim List.
--
-- The hourly ServicePower claim check (src/lib/server/spClaimPaymentSync.ts)
-- and the Claim List's "Sync Status" read each claim back from
-- ServicePower's claim retrieval API; these columns keep what it paid
-- (labor / parts / shipping / mileage / other / tax / total), when it paid,
-- when ServicePower received the claim, and when it was last checked.
-- Adds columns only — no existing data is changed.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table ticket_claim_details add column if not exists sp_paid_total numeric;
alter table ticket_claim_details add column if not exists sp_paid_labor numeric;
alter table ticket_claim_details add column if not exists sp_paid_parts numeric;
alter table ticket_claim_details add column if not exists sp_paid_shipping numeric;
alter table ticket_claim_details add column if not exists sp_paid_mileage numeric;
alter table ticket_claim_details add column if not exists sp_paid_other numeric;
alter table ticket_claim_details add column if not exists sp_paid_tax numeric;
alter table ticket_claim_details add column if not exists sp_payment_date date;
alter table ticket_claim_details add column if not exists sp_received_date date;
alter table ticket_claim_details add column if not exists sp_claim_checked_at timestamptz;
