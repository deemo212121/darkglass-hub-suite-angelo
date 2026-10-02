-- =====================================================================
-- 0347 — Editable "who can see the clock-in code".
--
-- HR → Clock-In Codes → "Who can see this code" (Edit). The list of roles
-- is saved per company; HR, Admin and SuperAdmin can always see it (and
-- are the only ones who can change the list or make a new code). With no
-- saved list yet, the default from 0346 applies: Branch Manager, Senior
-- Branch Manager, Technical Director, Technical Assistant Director.
--
-- Run once in the Supabase SQL Editor, after 0346.
-- =====================================================================

create table if not exists clock_in_code_settings (
  company_id uuid primary key,
  viewer_roles text[] not null default '{}',
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table clock_in_code_settings enable row level security;
alter table clock_in_code_settings force row level security;
drop policy if exists clock_in_code_settings_select on clock_in_code_settings;
create policy clock_in_code_settings_select on clock_in_code_settings
  for select using (company_id = auth_company_id());

/** The company's extra viewer roles (besides HR / Admin / SuperAdmin). */
create or replace function get_clock_code_viewer_roles()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.viewer_roles from clock_in_code_settings s where s.company_id = auth_company_id()),
    array['BRANCH_MANAGER', 'SENIOR_BRANCH_MANAGER', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR']
  );
$$;

create or replace function clock_code_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth_profile_id()
      and array(select upper(x) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x where x is not null)
          && (array['HR', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN'] || get_clock_code_viewer_roles())
  );
$$;

/** Save the viewer roles. HR / Admin / SuperAdmin only. */
create or replace function set_clock_code_viewer_roles(p_roles text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth_profile_id() is null or not clock_code_issuer() then
    raise exception 'Only HR can change who sees the clock-in code.';
  end if;
  insert into clock_in_code_settings (company_id, viewer_roles, updated_by, updated_at)
    values (auth_company_id(), array(select distinct upper(x) from unnest(coalesce(p_roles, '{}')) x where x is not null and x <> ''), auth_profile_id(), now())
    on conflict (company_id) do update
      set viewer_roles = excluded.viewer_roles, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

grant execute on function get_clock_code_viewer_roles() to authenticated;
grant execute on function clock_code_viewer() to authenticated;
grant execute on function set_clock_code_viewer_roles(text[]) to authenticated;
