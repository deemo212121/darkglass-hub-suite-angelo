-- =====================================================================
-- 0156 — Leaders tab: Technical Support was miscategorized in 0153.
--
-- Daven Hodge was seeded into BOTH "Technical Support" and "Technician" —
-- he's only Technical Director of the Technician (branch-manager)
-- hierarchy, not of Technical Support, so his Technical Support row is
-- removed entirely (Mark Marquez remains as its Manager).
--
-- "Tech Manager ATL/LC/NV" (Keven Khaiphanliane, Cooper Shaffett, John
-- Godfrey) were seeded under Technician alongside the real Branch
-- Managers, and picked up a reports_to pointing at a Senior Branch
-- Manager (0154) as a result. They actually belong to Technical Support,
-- reporting to Mark Marquez there — not to a Senior Branch Manager in the
-- Technician hierarchy.
--
-- Run once in the Supabase SQL Editor, after 0155.
-- =====================================================================

do $$
declare
  cid uuid;
begin
  select id into cid from companies where legacy_code = 'COMP001';
  if cid is null then
    return;
  end if;

  delete from hr_leaders_roster
    where company_id = cid and department = 'Technical Support' and person_name = 'Daven Hodge';

  update hr_leaders_roster
    set department = 'Technical Support', dept_sort = 7, row_sort = 3, reports_to = 'Mark Marquez'
    where company_id = cid and department = 'Technician' and person_name = 'Keven Khaiphanliane' and role_title = 'Tech Manager ATL';

  update hr_leaders_roster
    set department = 'Technical Support', dept_sort = 7, row_sort = 4, reports_to = 'Mark Marquez'
    where company_id = cid and department = 'Technician' and person_name = 'Cooper Shaffett' and role_title = 'Tech Manager LC';

  update hr_leaders_roster
    set department = 'Technical Support', dept_sort = 7, row_sort = 5, reports_to = 'Mark Marquez'
    where company_id = cid and department = 'Technician' and person_name = 'John Godfrey' and role_title = 'Tech Manager NV';
end $$;
