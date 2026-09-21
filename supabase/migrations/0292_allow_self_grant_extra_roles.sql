-- =====================================================================
-- 0292 — let a self-edit GROW extra_roles (add module access to your own
-- account), and let SUPERADMIN/SUPERSUPERADMIN self-edit payroll_excluded,
-- while still blocking every other self-edit case 0225 covers.
--
-- 0225 blocked extra_roles self-edits outright, lumped in with is_active,
-- branch_access, role, etc. — necessary at the time to close a real
-- privilege-escalation gap (self-granting ANY of those via a raw REST
-- call), but it also means nobody can unlock a brand-new module (e.g.
-- Accounting) for themselves without a second admin account already
-- existing to grant it from someone else's row instead.
--
-- extra_roles is carved out here, but only in the direction that ADDS
-- entries: a self-edit is let through only when every role already in
-- old.extra_roles is still present in new.extra_roles (new ⊇ old) — you
-- can grant yourself a new module, but you still can't drop one of your
-- own extra_roles, or swap one out for another, via a self-edit.
--
-- payroll_excluded (the Payroll tab's per-row inclusion checkbox, migration
-- 0112) landed in 0225's catch-all "block everything else" bucket by
-- omission, not by design — 0225's own comment lists the fields it
-- actually audited as real self-edit call sites, and that checkbox toggling
-- your OWN row was always one of them, right alongside every other
-- employee's row. Scoped to SUPERADMIN/SUPERSUPERADMIN only (not opened up
-- to every role) per this migration's own request, rather than the fully
-- unrestricted "always-safe" treatment display_name/email/etc. get.
--
-- Every other 0225 column check (role, is_active, branch_access,
-- company_id, frozen, etc.) is untouched below.
--
-- Run once in the Supabase SQL Editor, after 0290.
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

  -- frozen — only the auto-unfreeze (true -> false) self-edit has a real use.
  if new.frozen is distinct from old.frozen
     and not (old.frozen = true and new.frozen = false) then
    raise exception 'You do not have permission to change your own frozen status.';
  end if;
  if new.frozen_at is distinct from old.frozen_at
     or new.frozen_by is distinct from old.frozen_by
     or new.frozen_by_name is distinct from old.frozen_by_name then
    raise exception 'You do not have permission to change that field on your own account.';
  end if;

  -- extra_roles — see header comment. Only blocked when the edit would
  -- drop or swap an entry; strictly adding is allowed.
  if new.extra_roles is distinct from old.extra_roles
     and not (new.extra_roles @> old.extra_roles) then
    raise exception 'You do not have permission to change that field on your own account.';
  end if;

  -- payroll_excluded — see header comment. SUPERADMIN/SUPERSUPERADMIN only,
  -- both directions (checking or unchecking your own row's inclusion).
  if new.payroll_excluded is distinct from old.payroll_excluded
     and my_role not in ('SUPERADMIN', 'SUPERSUPERADMIN') then
    raise exception 'You do not have permission to change that field on your own account.';
  end if;

  -- Everything else has NO legitimate self-edit call site anywhere in the
  -- app today AND is either access/permission-determining or an integrity/
  -- audit field — block outright rather than silently allowing whatever a
  -- future column addition might bring along.
  if new.is_active is distinct from old.is_active
     or new.company_id is distinct from old.company_id
     or new.branch_access is distinct from old.branch_access
     or new.employment_type is distinct from old.employment_type
     or new.manager_name is distinct from old.manager_name
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

-- Trigger already points at this function (created in 0225) — replacing
-- the function body is enough, no need to touch the trigger itself.
