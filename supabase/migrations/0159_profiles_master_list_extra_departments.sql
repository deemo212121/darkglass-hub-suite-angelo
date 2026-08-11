-- =====================================================================
-- 0159 — Master List: let someone show up under more than one department
-- tab without changing their real (primary) department.
--
-- Some people genuinely belong to two departments at once (e.g. Daven
-- Hodge is Technical Director of both Current Technicians and Technical
-- Support) — profiles.department can only hold one value, so this adds a
-- second, purely-additive list: every name here is an EXTRA tab this
-- person also appears under in the Master List, on top of whichever
-- department profiles.department/the Leaders roster/role already resolve
-- to. Never touched by anything except the Master List's "duplicate to
-- another department" control.
--
-- Run once in the Supabase SQL Editor, after 0158.
-- =====================================================================

alter table profiles add column if not exists master_list_extra_departments text[] not null default '{}';
