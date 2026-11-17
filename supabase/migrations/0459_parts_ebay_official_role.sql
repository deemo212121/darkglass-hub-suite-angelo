-- =====================================================================
-- 0459 — "Parts Ebay" is now an official (built-in) User Type.
--
-- It was a custom role ("Ebay", code EBAY) made with Add Role. The app now
-- has it built in (src/lib/roleLabels.ts): label "Parts Ebay", Parts
-- department. The code stays EBAY, so everyone who holds it keeps it and
-- every page access set for it in Accessibility Management stays the same.
--
-- This removes only the old custom-role row (its name/label), so it leaves
-- the Custom Roles list and shows as "Parts Ebay" instead of "Ebay".
-- No person's role is changed. No access is changed.
--
-- Safe to run again. Run once in the Supabase SQL Editor.
-- =====================================================================

delete from custom_roles where code = 'EBAY';

notify pgrst, 'reload schema';
