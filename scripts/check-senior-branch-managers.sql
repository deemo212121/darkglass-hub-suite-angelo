-- ============================================================================
-- Read-only check: which branches actually have a Senior Branch Manager on
-- file? The Mileage tab's On Hold notification (AccountingDashboard.tsx's
-- handleTogglePayrollExclude) only reaches a "senior branch manager" if a
-- profile with role SENIOR_BRANCH_MANAGER (primary or extra_roles) has
-- assigned_branch matching the technician's own assigned_branch, exactly
-- (case/whitespace-insensitive). A branch with no match here means nobody
-- extra gets notified for that branch's technicians right now.
-- ============================================================================

-- 1. Every branch technicians are assigned to, and whether it has a match.
select
  t.assigned_branch as technician_branch,
  count(*) filter (where t.role = 'TECHNICIAN' or 'TECHNICIAN' = any(coalesce(t.extra_roles, '{}'))) as technician_count,
  (
    select string_agg(m.display_name, ', ')
    from profiles m
    where m.company_id = t.company_id
      and trim(lower(m.assigned_branch)) = trim(lower(t.assigned_branch))
      and (m.role = 'SENIOR_BRANCH_MANAGER' or 'SENIOR_BRANCH_MANAGER' = any(coalesce(m.extra_roles, '{}')))
  ) as senior_branch_managers_on_file
from profiles t
where (t.role = 'TECHNICIAN' or 'TECHNICIAN' = any(coalesce(t.extra_roles, '{}')))
  and t.is_active = true
  and t.assigned_branch is not null
  and t.assigned_branch <> ''
group by t.assigned_branch, t.company_id
order by senior_branch_managers_on_file nulls first, technician_branch;

-- 2. All SENIOR_BRANCH_MANAGER profiles on file, with their branch, so you
--    can spot typos/mismatches against the branch names technicians use.
select id, display_name, assigned_branch, role, extra_roles
from profiles
where role = 'SENIOR_BRANCH_MANAGER' or 'SENIOR_BRANCH_MANAGER' = any(coalesce(extra_roles, '{}'))
order by assigned_branch;
