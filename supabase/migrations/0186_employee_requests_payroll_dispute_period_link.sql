-- =====================================================================
-- 0186 — Links a payroll_dispute request to a real pay period and, once
-- approved, to the tech_custom_pay_items row that actually adds the
-- missing amount into the Tech Activity Report's payroll total.
--
-- period_start/period_end are only populated when the dispute was
-- submitted via the mobile On Hold Tickets "Dispute" tab (see migration
-- 0184's payrollReleasedAt/getMyPayslips matching) — that flow already
-- knows the exact payroll run the ticket was missed from. A dispute
-- submitted the free-text way (typed payPeriod, not from that flow) has
-- no structured period to auto-inject into, and stays acknowledgement-only
-- on approve.
--
-- custom_pay_item_id is set by AccountingDashboard.tsx's Approve handler
-- once it creates the matching tech_custom_pay_items line, and cleared
-- (after deleting that line) if the approval is ever reverted — see
-- handlePayrollDisputeAction's "pending"/non-approved branch.
--
-- Run once in the Supabase SQL Editor, after 0185.
-- =====================================================================

alter table employee_requests add column if not exists period_start date;
alter table employee_requests add column if not exists period_end date;
alter table employee_requests add column if not exists custom_pay_item_id uuid references tech_custom_pay_items(id) on delete set null;
