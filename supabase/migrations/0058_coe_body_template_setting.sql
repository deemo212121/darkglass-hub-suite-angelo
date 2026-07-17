-- =====================================================================
-- 0058 — Editable Certificate of Employment body template
--
-- The COE's prose paragraphs (between the greeting and the signature
-- block) can now be edited by an Admin, company-wide, without a code
-- change — stored in the existing companies.settings jsonb column as
-- {"coeBodyTemplate": "..."}, same pattern as 0053's mapProvider setting.
-- Doesn't touch the "Generate COE" form's actual entry fields (Employee
-- Name, Job Title, etc.) — those stay exactly as they are; the template
-- text just has placeholder tokens ({{employeeName}}, {{startDate}},
-- {{jobTitle}}, {{amount}}, {{month}}) substituted in at generation time.
-- Unset (null) means "use the built-in default text".
--
-- Run once in the Supabase SQL Editor, after 0057.
-- =====================================================================

create or replace function set_company_coe_body_template(p_template text)
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
    raise exception 'Only an Admin can edit the Certificate of Employment template';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{coeBodyTemplate}', to_jsonb(p_template))
  where id = v_company_id;
end;
$$;
