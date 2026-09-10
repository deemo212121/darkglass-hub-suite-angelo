-- =====================================================================
-- 0235 — Company-wide opt-out for the automatic weekly forced password
-- reset (src/lib/server/passwordResetSchedule.ts — every Monday at
-- midnight America/Chicago, flips must_change_password on every active
-- profile). Same companies.settings jsonb pattern as 0053's mapProvider,
-- 0063's coeBodyTemplate, 0067's defaultTechnician, and 0090's
-- notifyAdmins* settings — reading needs no new policy (companies_select
-- already lets any authenticated user read their own company row); writing
-- is gated to that company's ADMIN/SUPERADMIN via this RPC rather than
-- widening the blanket companies_update policy.
--
-- Toggled from AdminUserManagementPage.tsx (both /m/admin/user-management
-- and /m/hr/user-management dispatch through the same component), next to
-- the Activity Log button.
--
-- Run once in the Supabase SQL Editor, after 0234.
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

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN') then
    raise exception 'Only an Admin can change the weekly password reset setting';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{weeklyPasswordResetEnabled}', to_jsonb(p_enabled))
  where id = v_company_id;
end;
$$;
