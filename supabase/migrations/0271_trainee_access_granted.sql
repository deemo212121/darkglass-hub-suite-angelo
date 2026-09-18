-- =====================================================================
-- 0271 — Trainee "Grant Access" override: lets HR give a trainee full
-- access to their actual role's modules/submodules while
-- employment_type stays 'trainee' (Master List's Employment Status
-- column keeps showing "Trainee" for payroll/HR classification — this
-- only lifts the ACCESS restriction, not the employment classification).
--
-- Same "restrict-to-allowlist" shape as the Trainee restriction itself
-- (0152, roleLabels.ts's isModuleAllowedForTrainee/isSubmoduleAllowedForTrainee)
-- and the Frozen restriction (0223) — this is just a per-profile escape
-- hatch from it, checked alongside employment_type wherever the
-- restriction is computed (see getProfileForLogin in users.ts).
--
-- Run once in the Supabase SQL Editor, after 0270.
-- =====================================================================

alter table profiles add column if not exists trainee_access_granted boolean not null default false;
alter table profiles add column if not exists trainee_access_granted_at timestamptz;
alter table profiles add column if not exists trainee_access_granted_by uuid references profiles(id) on delete set null;
alter table profiles add column if not exists trainee_access_granted_by_name text;
