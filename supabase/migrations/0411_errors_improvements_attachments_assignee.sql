-- =====================================================================
-- 0411 — Admin → Errors & Improvements: attachments and who handles it.
--
-- Adds three columns to admin_errors_improvements (0409):
--   assigned_to / assigned_to_name — the person handling the item (picked
--     from the people who can open the page: Admin / SuperAdmin);
--   attachments — pictures and files on the item, as a JSON list of
--     { url, path, name, type, size }; the files themselves are in Firebase
--     Storage under companies/<company>/errors-improvements/<item id>/.
--
-- Columns only — no existing data changes, and the 0409 RLS policies cover
-- them as they are. Safe to run again. Run once in the Supabase SQL Editor
-- (Run without RLS), after 0409.
-- =====================================================================

alter table admin_errors_improvements
  add column if not exists assigned_to      uuid references profiles(id) on delete set null,
  add column if not exists assigned_to_name text,
  add column if not exists attachments      jsonb not null default '[]'::jsonb;
