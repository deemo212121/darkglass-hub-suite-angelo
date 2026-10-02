-- =====================================================================
-- 0346 — Who can see the clock-in code.
--
-- Seeing today's company code (HR → Clock-In Codes, Branch/Technician →
-- Clock-In Codes) and the who-used-it list: HR, Admin, SuperAdmin, Branch
-- Manager, Senior Branch Manager, Technical Director, Technical Assistant
-- Director (primary or extra role).
-- Making a new code stays HR / Admin / SuperAdmin (clock_code_issuer).
--
-- Run once in the Supabase SQL Editor, after 0345.
-- =====================================================================

create or replace function clock_code_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth_profile_id()
      and array(select upper(x) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x where x is not null)
          && array['HR', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN',
                   'BRANCH_MANAGER', 'SENIOR_BRANCH_MANAGER', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR']
  );
$$;
grant execute on function clock_code_viewer() to authenticated;

drop policy if exists clock_in_daily_codes_select on clock_in_daily_codes;
create policy clock_in_daily_codes_select on clock_in_daily_codes
  for select using (company_id = auth_company_id() and clock_code_viewer());
drop policy if exists clock_in_code_events_select on clock_in_code_events;
create policy clock_in_code_events_select on clock_in_code_events
  for select using (company_id = auth_company_id() and clock_code_viewer());

/** Today's company code — made if there isn't one yet. Anyone who may view the code. */
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
