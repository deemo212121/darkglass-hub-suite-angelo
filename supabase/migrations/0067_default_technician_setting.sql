-- =====================================================================
-- 0067 — Company-wide default technician for new tickets
--
-- New tickets previously always started with technician = "" (unassigned).
-- Admin can now set one fixed technician, company-wide, that every new
-- ticket is created with instead — same companies.settings jsonb pattern
-- as 0053's mapProvider and 0063's coeBodyTemplate settings.
-- Unset (empty string) means "leave new tickets unassigned", same as
-- today's behavior.
--
-- Run once in the Supabase SQL Editor, after 0066.
-- =====================================================================

create or replace function set_company_default_technician(p_technician text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN') then
    raise exception 'Only an Admin can set the default technician';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{defaultTechnician}', to_jsonb(p_technician))
  where id = v_company_id;
end;
$$;
