-- =====================================================================
-- 0167 — Truck Stock pull requests: add a "received" step
--
-- A pull request used to jump straight from "approved" to done — Parts
-- Manager approval alone stamped the Part Transaction line PO Made and
-- the Truck Stock Requests tab bucketed the row "Completed," even
-- though the part hadn't actually reached the branch that's going to
-- install it yet (approval only confirms the SOURCE branch is willing
-- to release it). Brings the pull-request flow in line with the
-- branch-transfer flow (0164): approved now means "in transit," and
-- the row only completes once the destination branch (the ticket's
-- own branch) confirms physical arrival via Mark Received — the same
-- point the Part Transaction line promotes PO Made -> Part Ready.
--
-- Run once in the Supabase SQL Editor, after 0166.
-- =====================================================================

alter table truck_stock_pull_requests add column if not exists received_by uuid references profiles(id);
alter table truck_stock_pull_requests add column if not exists received_at timestamptz;

alter table truck_stock_pull_requests drop constraint if exists truck_stock_pull_requests_status_check;
alter table truck_stock_pull_requests add constraint truck_stock_pull_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'received'));
