-- =====================================================================
-- 0448 — Technical Assistant Director: read technicians' pay and form rows
--
-- The app now gives a Technical Assistant Director (with no HR / Accounting
-- role of their own) a technician-only, view-only look at HR → Training
-- List, Employee Monitoring, Flash Tech, Staff Form Checklist, Clock-In
-- Codes, and Accounting → Accounting Dashboard's Tech Payroll
-- (src/lib/roleLabels.ts's TECH_SCOPED_PAGES). Most of what those pages show
-- is already readable company-wide; these five tables only let Admin /
-- Finance / HR read other people's rows (0224, 0404), so Tech Payroll's
-- custom pay lines, tax lines, adjustments and reviewed amounts — and the
-- checklist's N/A marks — would come back empty for them.
--
-- After this, a Technical Assistant Director (primary or extra role) can also
-- READ the rows of technicians in their company: primary role Technician,
-- Tech Manager, Branch Manager or Senior Branch Manager — the same people
-- the pages show (isTechScopeSubject), not the directors or office staff.
--
-- Nothing else changes: these are extra SELECT rules added next to the
-- existing ones (rules of the same kind are OR'd), so every existing rule —
-- including 0437's once-per-query rewrite — stays exactly as it is, and no
-- one gets any new insert / update / delete. No data is touched.
--
-- Run once in the Supabase SQL Editor, after 0447. Safe to run again.
-- =====================================================================

-- Holds Technical Assistant Director as primary or extra role.
create or replace function is_tech_scope_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (upper(regexp_replace(trim(role), '\s+', '_', 'g')) = 'TECHNICAL_ASSISTANT_DIRECTOR'
           or 'TECHNICAL_ASSISTANT_DIRECTOR' = any(extra_roles))
  );
$$;

-- A technician by primary role (legacy "Branch Manager" spelling counts too).
create or replace function is_tech_scope_subject(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = p_profile_id
      and upper(regexp_replace(trim(role), '\s+', '_', 'g'))
          in ('TECHNICIAN', 'TECHNICIAN_MANAGER', 'BRANCH_MANAGER', 'SENIOR_BRANCH_MANAGER')
  );
$$;

grant execute on function is_tech_scope_viewer() to authenticated;
grant execute on function is_tech_scope_subject(uuid) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tech_custom_pay_items',     -- Tech Payroll's custom pay lines
    'tech_tax_lines',            -- technicians' tax withholdings
    'payroll_adjustments',       -- reimbursements / deductions on the payroll row
    'payroll_review_breakdowns', -- reviewed pay per period
    'technician_form_exemptions' -- Staff Form Checklist's N/A marks
  ] loop
    execute format('drop policy if exists %1$s_select_tech_scope on %1$I', t);
    execute format(
      'create policy %1$s_select_tech_scope on %1$I for select using ('
      || 'company_id = (select auth_company_id()) and (select is_tech_scope_viewer()) and is_tech_scope_subject(profile_id))',
      t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
