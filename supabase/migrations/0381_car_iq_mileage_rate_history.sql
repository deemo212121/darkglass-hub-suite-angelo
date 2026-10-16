-- =====================================================================
-- 0381 — Car IQ mileage rates get effective dates (AccountingDashboard.tsx's
-- Car IQ tab). 0324 stored one with/without pair that a change simply
-- overwrote, so a new rate silently re-priced past periods too and there
-- was no record of what applied when. Now each change is an entry in
-- companies.settings.carIqMileageRateHistory:
--   [{ "effectiveDate": "YYYY-MM-DD", "with": 0.2, "without": 0.4,
--      "changedByName": "...", "changedAt": "..." }, ...]
-- A payroll period uses the entry in effect on its start date (a change
-- inside the period is flagged on the Tech Activity Report, same as a Car
-- IQ status switch). Future-dated entries are allowed (scheduled changes).
--
-- The first change seeds the history with the rates in use until now
-- (0324's carIqMileageRateWith/Without, else the 0.20/0.40 defaults) from
-- 2000-01-01, so earlier periods keep paying what they always did. Those
-- two flat keys are kept up to date with today's rate for older readers.
--
-- Admin / Finance / Super Admin only — role OR extra_roles.
-- Run once in the Supabase SQL Editor, after 0380. (Numbered 0371 in
-- janeyyy16's repo — renumbered here past this repo's own 0371-0380;
-- already applied to the shared database 2026-10-14.)
-- =====================================================================

create or replace function car_iq_rate_caller_company()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_ok boolean;
begin
  select company_id,
         (upper(coalesce(role, '')) in ('ADMIN', 'SUPERADMIN', 'FINANCE')
          or coalesce(extra_roles, '{}') && array['ADMIN', 'SUPERADMIN', 'FINANCE'])
    into v_company_id, v_ok
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
  if not coalesce(v_ok, false) then
    raise exception 'Only Admin/Finance can change the Car IQ mileage rates';
  end if;
  return v_company_id;
end;
$$;

-- Re-sorts the history and refreshes the flat "current" keys from it.
create or replace function car_iq_rate_write_history(p_company_id uuid, p_history jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sorted jsonb;
  v_current jsonb;
begin
  select coalesce(jsonb_agg(e order by e->>'effectiveDate'), '[]'::jsonb) into v_sorted
  from jsonb_array_elements(p_history) e;

  select e into v_current
  from jsonb_array_elements(v_sorted) e
  where (e->>'effectiveDate')::date <= current_date
  order by e->>'effectiveDate' desc
  limit 1;
  if v_current is null then
    v_current := v_sorted->0;
  end if;

  update companies
  set settings = coalesce(settings, '{}'::jsonb)
               || jsonb_build_object(
                    'carIqMileageRateHistory', v_sorted,
                    'carIqMileageRateWith', (v_current->>'with')::numeric,
                    'carIqMileageRateWithout', (v_current->>'without')::numeric)
  where id = p_company_id;
end;
$$;

create or replace function add_car_iq_mileage_rate(p_effective date, p_with numeric, p_without numeric, p_changed_by text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid := car_iq_rate_caller_company();
  v_settings jsonb;
  v_history jsonb;
begin
  if p_effective is null then
    raise exception 'Pick the date the rate takes effect';
  end if;
  if p_with is null or p_without is null or p_with < 0 or p_without < 0 then
    raise exception 'Mileage rates cannot be blank or negative';
  end if;

  select coalesce(settings, '{}'::jsonb) into v_settings from companies where id = v_company_id;
  v_history := v_settings->'carIqMileageRateHistory';
  if v_history is null or jsonb_typeof(v_history) <> 'array' or jsonb_array_length(v_history) = 0 then
    v_history := jsonb_build_array(jsonb_build_object(
      'effectiveDate', '2000-01-01',
      'with', coalesce((v_settings->>'carIqMileageRateWith')::numeric, 0.20),
      'without', coalesce((v_settings->>'carIqMileageRateWithout')::numeric, 0.40),
      'changedByName', null,
      'changedAt', null));
  end if;

  -- One entry per date: re-saving a date replaces it.
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_history
  from jsonb_array_elements(v_history) e
  where e->>'effectiveDate' <> to_char(p_effective, 'YYYY-MM-DD');

  v_history := v_history || jsonb_build_array(jsonb_build_object(
    'effectiveDate', to_char(p_effective, 'YYYY-MM-DD'),
    'with', p_with,
    'without', p_without,
    'changedByName', nullif(trim(coalesce(p_changed_by, '')), ''),
    'changedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

  perform car_iq_rate_write_history(v_company_id, v_history);
end;
$$;

create or replace function delete_car_iq_mileage_rate(p_effective date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid := car_iq_rate_caller_company();
  v_history jsonb;
begin
  select coalesce(settings->'carIqMileageRateHistory', '[]'::jsonb) into v_history from companies where id = v_company_id;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_history
  from jsonb_array_elements(v_history) e
  where e->>'effectiveDate' <> to_char(p_effective, 'YYYY-MM-DD');
  if jsonb_array_length(v_history) = 0 then
    raise exception 'Keep at least one Car IQ mileage rate';
  end if;
  perform car_iq_rate_write_history(v_company_id, v_history);
end;
$$;

-- The writer takes a company id, so only the two checked functions above may call it.
revoke all on function car_iq_rate_write_history(uuid, jsonb) from public, anon, authenticated;

grant execute on function add_car_iq_mileage_rate(date, numeric, numeric, text) to authenticated;
grant execute on function delete_car_iq_mileage_rate(date) to authenticated;
