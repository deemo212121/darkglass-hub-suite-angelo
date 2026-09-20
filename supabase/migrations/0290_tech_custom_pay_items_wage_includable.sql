-- =====================================================================
-- 0290 — tech_custom_pay_items.is_wage_includable
--
-- Whether a custom pay line counts toward the FLSA weighted-regular-rate
-- calculation (AccountingDashboard.tsx's techIncludablePay) — real wages
-- (a commission line, a completed-tickets line) do; an expense
-- reimbursement, a per-diem stipend, or an unrelated cash deduction
-- (a copay, a chargeback) don't, even though they still count toward
-- Total Payment.
--
-- Previously this was guessed from the label text via a regex
-- (/reimburs|mileage|allowance|stipend|co.?pay|deduction/i) — which kept
-- missing real deductions phrased differently each time ("Insurance",
-- "Co pay paid in cash", "700 -$250 (6thcharged) = remaining balance").
-- An explicit, Finance-set flag replaces guessing from text.
--
-- Backfill for existing rows uses that same regex one last time, so
-- history doesn't silently flip the moment this column exists — from here
-- on, new/edited rows are set explicitly by whoever enters them (defaults
-- to true — "counts as wages" — which is the common case).
--
-- Run once in the Supabase SQL Editor, after 0289.
-- =====================================================================

alter table tech_custom_pay_items
  add column if not exists is_wage_includable boolean not null default true;

update tech_custom_pay_items
set is_wage_includable = not (label ~* 'reimburs|mileage|allowance|stipend|co.?pay|deduction')
where label is not null;
