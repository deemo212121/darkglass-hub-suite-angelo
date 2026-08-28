-- =====================================================================
-- 0146 — Leaders tab: reporting hierarchy within a department
--
-- The Technician department block has its own internal hierarchy —
-- Technical Director -> Assistant Technical Director -> Senior Branch
-- Manager -> that manager's own Branch/Tech Managers — instead of one flat
-- list like every other department. `reports_to` names who a row reports
-- to WITHIN its own department (null = top of that department's tree, or
-- no hierarchy at all for departments that don't use one).
--
-- Backfill cross-references migration 0126's general_info_branch_roles
-- seed (senior_branch_manager / branch_manager / technical_manager per
-- branch) against the names already seeded into hr_leaders_roster's
-- Technician rows by 0145, to reconstruct which Senior Branch Manager each
-- Branch/Tech Manager actually reports to.
--
-- Run once in the Supabase SQL Editor, after 0145.
-- =====================================================================

alter table hr_leaders_roster add column if not exists reports_to text;

do $$
declare
  cid uuid;
begin
  select id into cid from companies where legacy_code = 'COMP001';
  if cid is null then
    return;
  end if;

  -- Technical Director -> (top, no parent) — leave null.
  -- Assistant Technical Director reports to the Technical Director.
  update hr_leaders_roster
    set reports_to = 'Daven Hodge'
    where company_id = cid and department = 'Technician' and person_name = 'Alexxis Henry' and role_title ilike '%Assistant Technical Director%';

  -- Every Senior Branch Manager reports to the Assistant Technical Director.
  update hr_leaders_roster
    set reports_to = 'Alexxis Henry'
    where company_id = cid and department = 'Technician' and role_title = 'Senior Branch Manager';

  -- Each Branch/Tech Manager reports to their region's Senior Branch
  -- Manager, per 0126's branch->senior_branch_manager mapping.
  update hr_leaders_roster set reports_to = 'Matt Simmons'
    where company_id = cid and department = 'Technician' and person_name in
      ('Keven Khaiphanliane', 'Bryeshawn Butler', 'Lance Novak', 'Chris Simpson', 'Andy Oh');

  update hr_leaders_roster set reports_to = 'Lashamus Dowell'
    where company_id = cid and department = 'Technician' and person_name in
      ('Matthew Nichols', 'Derious Nichols', 'John Godfrey', 'Sean Smith', 'Jordan Stanley');

  update hr_leaders_roster set reports_to = 'Danny Thornton'
    where company_id = cid and department = 'Technician' and person_name in
      ('Matthew McCarry', 'Cooper Shaffett', 'Garrett McCarley', 'Erick Guzman', 'David Sims');
end $$;
