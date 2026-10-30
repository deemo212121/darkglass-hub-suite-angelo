-- =====================================================================
-- 0415 — Expenses: more than one receipt per expense.
-- (0414 in Angelo's repo — renumbered here, past 0414_expense_flash_tech_allowance.)
--
-- An expense request can now carry several photos / PDFs. The first stays in
-- receipt_url / receipt_path (migration 0104) so everything that already
-- reads those keeps working; the rest go in extra_receipts as a list of
-- { "url": ..., "path": ... } — the Firebase Storage download URL and the
-- file's full path (to delete it when the expense or the receipt is removed).
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table expenses add column if not exists extra_receipts jsonb not null default '[]'::jsonb;
