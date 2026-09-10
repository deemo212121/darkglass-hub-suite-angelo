-- =====================================================================
-- 0236 — restrict set_company_weekly_password_reset (0235) to SUPERADMIN
-- only, per the user's explicit call — a plain ADMIN could flip it before
-- this, now only the per-company SUPERADMIN role can.
--
-- Run once in the Supabase SQL Editor, after 0235.
-- =====================================================================

create or replace function set_company_weekly_password_reset(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) <> 'SUPERADMIN' then
    raise exception 'Only a Super Admin can change the weekly password reset setting';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{weeklyPasswordResetEnabled}', to_jsonb(p_enabled))
  where id = v_company_id;
end;
$$;
