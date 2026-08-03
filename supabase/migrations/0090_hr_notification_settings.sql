-- =====================================================================
-- 0090 — Company-wide "also notify all Admins" toggles for the three
-- one-to-one HR sends that otherwise never reach Admin/HR as a group:
-- Employee Warning Form, Certificate of Employment, and the W-8BEN/W-4/W-9
-- tax forms. Same companies.settings jsonb pattern as 0053's mapProvider,
-- 0063's coeBodyTemplate, and 0067's defaultTechnician settings.
--
-- Custom Forms already broadcast to all HR/Admin/Manager by default (see
-- customFormsBridge.ts's findHrFirebaseUids) and are deliberately NOT
-- covered here — this migration only adds settings for the flows that are
-- otherwise strictly one-to-one DMs.
--
-- Run once in the Supabase SQL Editor, after 0076.
-- =====================================================================

create or replace function set_notify_admins_warning_form(p_enabled boolean)
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
    raise exception 'Only an Admin can change notification settings';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{notifyAdminsWarningForm}', to_jsonb(p_enabled))
  where id = v_company_id;
end;
$$;

create or replace function set_notify_admins_coe(p_enabled boolean)
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
    raise exception 'Only an Admin can change notification settings';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{notifyAdminsCoe}', to_jsonb(p_enabled))
  where id = v_company_id;
end;
$$;

create or replace function set_notify_admins_tax_forms(p_enabled boolean)
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
    raise exception 'Only an Admin can change notification settings';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{notifyAdminsTaxForms}', to_jsonb(p_enabled))
  where id = v_company_id;
end;
$$;
