-- =====================================================================
-- 0324 — Car IQ mileage rates ($/mi with vs. without) made editable
-- instead of hardcoded — AccountingDashboard.tsx's Car IQ tab. Same
-- companies.settings jsonb + RPC pattern as 0067's defaultTechnician /
-- 0267's flashTechOpenAlertEmail settings, so the two rates can change
-- (e.g. company policy or fuel-cost adjustment) without a code deploy.
-- roleLabels.ts's CAR_IQ_MILEAGE_RATE_WITH/WITHOUT constants stay as the
-- fallback defaults for a company that's never set this.
--
-- Run once in the Supabase SQL Editor, after 0323.
-- =====================================================================

create or replace function set_car_iq_mileage_rates(p_with numeric, p_without numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'FINANCE') then
    raise exception 'Only Admin/Finance can set the Car IQ mileage rates';
  end if;

  if p_with < 0 or p_without < 0 then
    raise exception 'Mileage rates cannot be negative';
  end if;

  update companies
  set settings = jsonb_set(
        jsonb_set(coalesce(settings, '{}'::jsonb), '{carIqMileageRateWith}', to_jsonb(p_with)),
        '{carIqMileageRateWithout}', to_jsonb(p_without)
      )
  where id = v_company_id;
end;
$$;
