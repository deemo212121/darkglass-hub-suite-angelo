-- =====================================================================
-- 0150 — Current Technicians roster cleanup.
--
-- Two problems visible in the live Technician department rows:
--
-- 1. Several rows have a role-title-looking string in the NAME field
--    ("Senior Branch Manager", "Branch Manager MG", "Tech Manager", …)
--    instead of a real person's name — almost certainly from using the
--    generic "+ Add" button (which defaults Name to "New Person") and
--    typing into the wrong field. These aren't real people; delete them.
--    (If any of these actually *was* meant to hold a real name, just
--    re-add them with the new per-row "+" duplicate button, which
--    pre-fills the title so only the name needs typing.)
--
-- 2. Every real Branch Manager row carries a location-code suffix
--    ("Branch Manager CG", "Branch Manager WM", …) and a few "Tech
--    Manager" rows leaked back in — but Current Technicians is only
--    supposed to use 4 titles now (Technical Director / Technical
--    Assistant Director / Senior Branch Manager / Branch Manager, see
--    TECHNICIAN_DEPARTMENT_TITLES in ReportHRDaily.tsx), with the branch
--    itself already shown via the person's own assigned_branch (see the
--    Master List's Current Technicians tab). Normalize every title down
--    to one of those 4.
--
-- Run once in the Supabase SQL Editor, after 0149. Double-check the
-- delete step's result in case any of the deleted rows actually had a
-- real name that just happened to look like a title.
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
  where company_id = cid
    and department = 'Technician'
    and person_name ~* '^(Technical Director|Technical Assistant Director|Assistant Technical Director|Senior Branch Manager|Branch Manager(\s+.+)?|Tech Manager(\s+.+)?)$';

  update hr_leaders_roster
    set role_title = 'Branch Manager'
    where company_id = cid
      and department = 'Technician'
      and (role_title ~* '^Branch Manager\s+.+$' or role_title ~* '^Tech Manager(\s+.+)?$');

  update hr_leaders_roster
    set role_title = 'Technical Assistant Director'
    where company_id = cid and department = 'Technician' and role_title = 'Assistant Technical Director';
end $$;
