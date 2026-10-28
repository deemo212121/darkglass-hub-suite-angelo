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
-- Only IT (main or extra role) chooses who handles an item: a trigger
-- refuses a change to assigned_to from anyone else signed in to the app.
-- The SQL Editor and the server (no signed-in user) aren't affected, nor
-- is the cleanup when a profile is deleted.
--
-- Columns and a trigger only — no existing data changes, and the 0409 RLS
-- policies cover the new columns as they are. Safe to run again. Run once
-- in the Supabase SQL Editor (Run without RLS), after 0409.
-- =====================================================================

alter table admin_errors_improvements
  add column if not exists assigned_to      uuid references profiles(id) on delete set null,
  add column if not exists assigned_to_name text,
  add column if not exists attachments      jsonb not null default '[]'::jsonb;

create or replace function admin_errors_improvements_assign_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller_uid text := nullif(current_setting('request.jwt.claims', true), '')::json->>'sub';
begin
  -- pg_trigger_depth() = 1: a direct save, not the "on delete set null"
  -- cascade when a profile is deleted (that one must go through).
  if new.assigned_to is distinct from (case when tg_op = 'INSERT' then null else old.assigned_to end)
     and pg_trigger_depth() = 1
     and caller_uid is not null
     and not exists (
       select 1 from profiles
       where firebase_uid = caller_uid
         and (role = 'IT' or 'IT' = any(extra_roles))
     ) then
    raise exception 'Only IT can choose who handles an item.';
  end if;
  return new;
end;
$$;

drop trigger if exists admin_errors_improvements_assign_guard on admin_errors_improvements;
create trigger admin_errors_improvements_assign_guard
  before insert or update on admin_errors_improvements
  for each row execute function admin_errors_improvements_assign_guard();
