-- Department + a manually-assigned Branch Manager on the Add Candidate form
-- (ReportHRDaily.tsx) — department has no fixed company-wide list (same
-- free-text convention as profiles.department), while branch_manager_id
-- lets HR pick a specific manager instead of always relying on the
-- Hiring table's auto-derived "whoever holds Branch Manager for this
-- candidate's branch" (branchManagerByBranch), which breaks down for a
-- branch with no manager on file yet or more than one candidate.
alter table hr_candidates add column if not exists department text;
alter table hr_candidates add column if not exists branch_manager_id uuid references profiles(id) on delete set null;
