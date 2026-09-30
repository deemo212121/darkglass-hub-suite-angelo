-- =====================================================================
-- 0330 — Pre-Claim: editable Service Performed.
--
-- The Pre-Claim modal shows the latest visit's Service Performed text; per
-- the user's explicit call Claims can now edit it for the claim. The edited
-- text is stored here (the visit's own record is left untouched). Null =
-- use the latest visit's text. Sent to ServicePower as
-- servicePerformedDescription.
--
-- Additive only — one nullable column, no existing rows touched. Existing
-- ticket_claim_details RLS already covers it.
-- Run once in the Supabase SQL Editor, after 0329.
-- =====================================================================

alter table ticket_claim_details add column if not exists service_performed text;
