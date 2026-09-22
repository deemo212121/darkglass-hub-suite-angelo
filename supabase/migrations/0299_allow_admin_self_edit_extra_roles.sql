-- =====================================================================
-- 0299 — let Admin/SuperAdmin/SuperSuperAdmin self-edit their own extra_roles
--
-- 0225's restrict_profile_self_edit_columns() already lets a trusted-tier
-- account (ADMIN/SUPERADMIN/SUPERSUPERADMIN) self-edit their own primary
-- `role` column, but the exact same exception was never extended to
-- `extra_roles` — that column was blocked for EVERY role, including
-- SuperAdmin, with no exception at all. That's an inconsistency, not a
-- deliberate choice: a SuperAdmin already bypasses every access gate in
-- the app regardless of what's in their own extra_roles (hasDashboardAccess
-- always returns true for SUPERADMIN before it even looks at extra_roles),
-- so there is no real self-lockout risk in letting one edit their own.
--
-- The restriction stays fully in place for everyone below that tier —
-- this does NOT reopen the real privilege-escalation case (e.g. a CSR
-- Agent self-granting "ADMIN" via their own extra_roles), since the
-- `my_role not in (...)` check below is unchanged from 0225's.
--
-- Run once in the Supabase SQL Editor, after 0225.
-- =====================================================================

create or replace function restrict_profile_self_edit_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_self boolean;
  my_role text;
begin
  is_self := (auth_profile_id() is not null) and (old.id = auth_profile_id());
  if not is_self then
    return new;
  end if;

  my_role := old.role; -- the caller's OWN role as of BEFORE this edit

  -- Role — mirrors profile.tsx's ACCOUNT_FIELD_EDIT_ROLES exactly.
  if new.role is distinct from old.role
     and my_role not in ('ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN') then
    raise exception 'You do not have permission to change your own role.';
  end if;

  -- Extra roles — same trusted-tier exception as role above (see this
  -- migration's own header comment for why 0225 originally left this one
  -- unconditional).
  if new.extra_roles is distinct from old.extra_roles
     and my_role not in ('ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN') then
    raise exception 'You do not have permission to change your own extra roles.';
  end if;

  -- Required Check-In/Out + Days Off — mirrors profile.tsx's SCHEDULE_EDIT_ROLES.
  if (new.required_check_in is distinct from old.required_check_in
      or new.required_check_out is distinct from old.required_check_out
      or new.off_days is distinct from old.off_days)
     and my_role not in (
       'SUPERADMIN', 'ADMIN', 'HR', 'MANAGER', 'SENIOR_MANAGER',
       'BRANCH_MANAGER', 'SENIOR_BRANCH_MANAGER', 'CSR_MANAGER',
       'CLAIMS_MANAGER', 'PARTS_MANAGER', 'BIZOPS_MANAGER', 'BIZOPS_SENIOR_MANAGER'
     ) then
    raise exception 'You do not have permission to change your own schedule.';
  end if;

  -- Schedule timezone — mirrors profile.tsx's canEditTimezone (SUPERADMIN only).
  if new.schedule_timezone is distinct from old.schedule_timezone
     and my_role <> 'SUPERADMIN' then
    raise exception 'You do not have permission to change your own timezone.';
  end if;

  -- must_change_password — only the self-clear direction has a real use.
  if new.must_change_password is distinct from old.must_change_password
     and new.must_change_password = true then
    raise exception 'Cannot set your own must-change-password flag.';
  end if;

  -- frozen — only the auto-unfreeze-on-sign direction has a real use.
  if new.frozen is distinct from old.frozen
     and not (old.frozen = true and new.frozen = false) then
    raise exception 'You do not have permission to change your own frozen status.';
  end if;
  if new.frozen_at is distinct from old.frozen_at
     or new.frozen_by is distinct from old.frozen_by
     or new.frozen_by_name is distinct from old.frozen_by_name then
    raise exception 'You do not have permission to change that field on your own account.';
  end if;

  -- Everything else below still has NO legitimate self-edit call site
  -- anywhere in the app — unchanged from 0225, extra_roles removed from
  -- this list since it's now handled by its own conditional check above.
  if new.is_active is distinct from old.is_active
     or new.company_id is distinct from old.company_id
     or new.branch_access is distinct from old.branch_access
     or new.employment_type is distinct from old.employment_type
     or new.manager_name is distinct from old.manager_name
     or new.payroll_excluded is distinct from old.payroll_excluded
     or new.master_list_extra_departments is distinct from old.master_list_extra_departments
     or new.technician_id is distinct from old.technician_id
     or new.username is distinct from old.username
     or new.permissions is distinct from old.permissions
     or new.employee_id is distinct from old.employee_id
     or new.firebase_uid is distinct from old.firebase_uid
     or new.id is distinct from old.id
     or new.employee_info is distinct from old.employee_info
     or new.last_login_ip is distinct from old.last_login_ip
     or new.failed_login_count is distinct from old.failed_login_count
     or new.locked_until is distinct from old.locked_until
     or new.current_session_id is distinct from old.current_session_id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by
     or new.updated_at is distinct from old.updated_at
  then
    raise exception 'You do not have permission to change that field on your own account.';
  end if;

  return new;
end;
$$;
