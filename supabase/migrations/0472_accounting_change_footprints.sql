-- =====================================================================
-- 0472 — (John Oliver's 0471, renumbered past 0471_timecard_footprint.)
-- Accounting footprints: every change to payroll data is written
-- to the Accounting Dashboard's Activity Logs (module_activity_log,
-- module 'accounting') by the database itself — whichever page, wizard,
-- import or tool made it. Each entry: who (the signed-in person), what
-- (e.g. "Changed a custom pay line"), whose pay and which period / day,
-- and every changed field as "old → new".
--
-- Covered: Tech Activity Report (custom lines, manual pay — LDT / mileage /
-- training / OW %, category counts, tax lines, Hourly + OT mode, repair
-- rates), Done marks and Reviewed Periods rows, payroll adjustments,
-- payslip notes, Internal Notes, pay-rate (salary) entries, payroll
-- locks, daily mileage, and timecards edited by someone other than the
-- employee (a technician's own clock-ins aren't logged — they'd bury the
-- rest).
--
-- Log rows are insert-only (0115's policies) — nobody can edit or delete
-- them. Run once in the Supabase SQL Editor, after 0471.
-- =====================================================================

create or replace function accounting_footprint()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  kind text := tg_argv[0];            -- action prefix, e.g. 'custom_line'
  self_skip boolean := coalesce(tg_argv[1], 'false') = 'true';
  me uuid;
  o jsonb;
  n jsonb;
  r jsonb;
  row_owner uuid;
  company uuid;
  skip_keys text[] := array['id', 'company_id', 'profile_id', 'employee_id', 'created_at', 'updated_at', 'updated_by', 'updated_by_name',
    'created_by', 'created_by_name', 'set_by', 'reviewed_by', 'sort_order', 'position', 'corrected_by', 'corrected_at'];
  details jsonb := '{}'::jsonb;
  k text;
  ov text;
  nv text;
  who text;
  span text;
begin
  me := auth_profile_id();
  o := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  n := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  r := case when tg_op = 'DELETE' then o else n end;
  row_owner := nullif(coalesce(r ->> 'profile_id', r ->> 'recipient_id', ''), '')::uuid;
  company := coalesce(nullif(r ->> 'company_id', '')::uuid, (select company_id from profiles where id = row_owner), auth_company_id());
  -- Server jobs (no signed-in person) and, where asked, the employee's own
  -- writes (clock-ins) aren't footprints.
  if me is null or company is null then return null; end if;
  if self_skip and row_owner is not null and row_owner = me then return null; end if;

  for k in select jsonb_object_keys(o || n) loop
    continue when k = any(skip_keys);
    ov := o ->> k;
    nv := n ->> k;
    if tg_op = 'UPDATE' then
      continue when ov is not distinct from nv;
      details := details || jsonb_build_object(k, coalesce(ov, '—') || ' → ' || coalesce(nv, '—'));
    else
      continue when coalesce(ov, nv) is null or coalesce(ov, nv) = '';
      details := details || jsonb_build_object(k, coalesce(ov, nv));
    end if;
  end loop;
  if tg_op = 'UPDATE' and details = '{}'::jsonb then return null; end if;

  who := (select coalesce(nullif(display_name, ''), email) from profiles where id = row_owner);
  span := case
    when r ? 'period_start' then to_char((r ->> 'period_start')::date, 'MM/DD') || ' – ' || to_char((r ->> 'period_end')::date, 'MM/DD/YYYY')
    when r ? 'work_date' then to_char((r ->> 'work_date')::date, 'MM/DD/YYYY')
    when r ? 'effective_date' then 'effective ' || to_char((r ->> 'effective_date')::date, 'MM/DD/YYYY')
    else null
  end;

  insert into module_activity_log (company_id, module, actor_id, actor_name, action, target_type, target_id, target_label, details)
  values (
    company, 'accounting', me,
    (select coalesce(nullif(display_name, ''), email) from profiles where id = me),
    kind || case tg_op when 'INSERT' then '_added' when 'DELETE' then '_removed' else '_changed' end,
    tg_table_name,
    coalesce(row_owner::text, r ->> 'id'),
    nullif(concat_ws(' · ', who, span, nullif(r ->> 'branch', '')), ''),
    details
  );
  return null;
exception when others then
  -- A footprint must never block the change itself.
  raise warning 'accounting_footprint(%): %', tg_table_name, sqlerrm;
  return null;
end;
$$;

do $$
declare
  spec text[];
  specs text[][] := array[
    array['tech_custom_pay_items',       'custom_line',       'false'],
    array['tech_manual_pay_items',       'manual_pay',        'false'],
    array['tech_category_overrides',     'category_count',    'false'],
    array['tech_tax_lines',              'tax_line',          'false'],
    array['tech_repair_rates',           'repair_rate',       'false'],
    array['payroll_hourly_ot_overrides', 'hourly_ot_mode',    'false'],
    array['payroll_review_marks',        'review_mark',       'false'],
    array['payroll_review_breakdowns',   'reviewed_row',      'false'],
    array['payroll_adjustments',         'payroll_adjustment','false'],
    array['payroll_employee_notes',      'payslip_note',      'false'],
    array['payroll_period_notes',        'internal_note',     'false'],
    array['payroll_period_locks',        'payroll_lock',      'false'],
    array['salary_entries',              'pay_rate',          'false'],
    array['tech_daily_mileage',          'daily_mileage',     'false'],
    array['timecard_entries',            'timecard',          'true'],
    array['trainee_timecard_entries',    'trainee_timecard',  'true']
  ];
begin
  foreach spec slice 1 in array specs loop
    if to_regclass('public.' || spec[1]) is null then
      raise notice 'footprints: % not found, skipped', spec[1];
      continue;
    end if;
    execute format('drop trigger if exists trg_accounting_footprint on %I', spec[1]);
    execute format(
      'create trigger trg_accounting_footprint after insert or update or delete on %I for each row execute function accounting_footprint(%L, %L)',
      spec[1], spec[2], spec[3]
    );
  end loop;
end;
$$;
