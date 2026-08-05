-- =====================================================================
-- 0132 — OR/Transaction Number on expenses
--
-- A free-text field for the Official Receipt / transaction number printed
-- on the actual receipt, distinct from the receipt file attachment itself
-- (receipt_url/receipt_path, migration 0104) — lets Finance cross-reference
-- an expense against the physical/e-receipt without opening the attachment.
--
-- Run once in the Supabase SQL Editor, after 0131.
-- =====================================================================

alter table expenses add column if not exists or_number text;
