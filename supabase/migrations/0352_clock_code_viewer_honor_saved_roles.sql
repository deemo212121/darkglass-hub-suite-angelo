-- =====================================================================
-- 0352 — Clock-in code: honor the saved "Who can see this code" list.
--
-- The live clock_code_viewer() no longer matched 0347: with Parts Manager,
-- Parts Team Leader and Parts ticked on HR → Clock-In Codes → "Who can see
-- this code", get_clock_code_viewer_roles() returned them, yet every Parts
-- user still got "You don't have access to the clock-in code." (Branch
-- Manager and above were fine). This puts back the 0347 rule: HR / Admin /
-- SuperAdmin always, plus every role on the saved list — primary or extra
-- role, compared trimmed and upper-cased.
--
-- Function definition only — no data is changed.
-- Run once in the Supabase SQL Editor, after 0351.
-- =====================================================================

create or replace function clock_code_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth_profile_id()
      and array(
            select upper(trim(x)) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x
            where x is not null and trim(x) <> ''
          )
          && (array['HR', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN']
              || array(select upper(trim(r)) from unnest(get_clock_code_viewer_roles()) r))
  );
$$;

grant execute on function clock_code_viewer() to authenticated;
