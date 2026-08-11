-- =====================================================================
-- 0160 — Daven Hodge still shows "Team Leader" after 0156-0159.
--
-- The Master List now picks a person's HIGHEST-tier roster row (see
-- ReportHRDaily.tsx's leadersBestRowByName), which fixes a low-tier stray
-- row losing to a real senior one — but this only helps if his real
-- "Technical Director" rows actually still outrank the stray one. If a
-- stray row also got its tier bumped to "senior" at some point (e.g. via
-- the tier dropdown on the Leaders tab) while its title stayed
-- "Team Leader", the two rows tie on tier and whichever sorts first by
-- department wins — still possibly the wrong one.
--
-- Rather than guess further, this just keeps Daven Hodge's two real rows
-- (Technical Director — Technical Support and Technician) and removes
-- anything else under his name, whatever tier it ended up at.
--
-- Run once in the Supabase SQL Editor, after 0159.
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
    and person_name = 'Daven Hodge'
    and role_title <> 'Technical Director';
end $$;
