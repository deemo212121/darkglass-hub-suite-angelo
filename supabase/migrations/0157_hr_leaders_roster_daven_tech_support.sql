-- =====================================================================
-- 0157 — Revises 0156: Daven Hodge stays at the top of BOTH Technician
-- and Technical Support, not just Technician.
--
-- 0156 removed his Technical Support row entirely. That was wrong — he's
-- the highest person in both departments. Re-add him there as Technical
-- Director (dept_sort/row_sort matching Technical Support's existing
-- convention), and have Mark Marquez report to him, same "top person for
-- this department" pattern the Technician hierarchy already uses.
--
-- Run once in the Supabase SQL Editor, after 0156.
-- =====================================================================

do $$
declare
  cid uuid;
begin
  select id into cid from companies where legacy_code = 'COMP001';
  if cid is null then
    return;
  end if;

  insert into hr_leaders_roster (company_id, department, role_title, person_name, tier, dept_sort, row_sort, reports_to)
  select cid, 'Technical Support', 'Technical Director', 'Daven Hodge', 'senior', 7, 1, null
  where not exists (
    select 1 from hr_leaders_roster
    where company_id = cid and department = 'Technical Support' and person_name = 'Daven Hodge'
  );

  update hr_leaders_roster
    set reports_to = 'Daven Hodge'
    where company_id = cid and department = 'Technical Support' and person_name = 'Mark Marquez';
end $$;
