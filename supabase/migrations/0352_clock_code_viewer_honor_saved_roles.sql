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
-- Function definitions only (clock_code_viewer, ensure_company_clock_in_code) —
-- no data is changed.
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

-- The code itself — same as 0346: made for today if missing, shown only to
-- clock_code_viewer() (re-applied so it is guaranteed to use the check above).
create or replace function ensure_company_clock_in_code()
returns table (out_code text, out_date date, out_created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  co uuid := auth_company_id();
  d date := clock_code_today();
begin
  if auth_profile_id() is null or not clock_code_viewer() then
    raise exception 'You don''t have access to the clock-in code.';
  end if;
  insert into clock_in_daily_codes (company_id, valid_date, code)
    values (co, d, lpad(floor(random() * 10000)::int::text, 4, '0'))
    on conflict (company_id, valid_date) where not revoked do nothing;
  return query
    select c.code, c.valid_date, c.created_at from clock_in_daily_codes c
    where c.company_id = co and c.valid_date = d and not c.revoked;
end;
$$;

grant execute on function clock_code_viewer() to authenticated;
grant execute on function ensure_company_clock_in_code() to authenticated;
