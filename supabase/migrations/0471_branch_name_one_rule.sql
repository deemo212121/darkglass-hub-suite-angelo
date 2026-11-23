-- =====================================================================
-- 0471 — One rule for "is this the same branch?"
--
-- A branch is often typed more than one way: "Jackson,MS", "Jackson, MS",
-- "jackson ms". The approval chain only treated the first two as the same
-- branch; the app now treats all of them as one branch everywhere
-- (src/lib/branchName.ts), so the database does too.
--
-- chain_norm_branch now ignores capitals, spaces, commas and dots (the same
-- rule Terms & Conditions already uses, 0455). It's only used to compare
-- branches; nothing is saved with it, and no row is changed.
--
-- Effect: a manager whose branch is spelled "Jackson MS" now covers people
-- at "Jackson, MS" (before, they didn't match).
--
-- Run once in the Supabase SQL Editor, after 0470. Safe to run again.
-- =====================================================================

create or replace function chain_norm_branch(b text)
returns text language sql immutable as $$
  select nullif(lower(regexp_replace(coalesce(b, ''), '[^a-zA-Z0-9]', '', 'g')), '');
$$;

notify pgrst, 'reload schema';
