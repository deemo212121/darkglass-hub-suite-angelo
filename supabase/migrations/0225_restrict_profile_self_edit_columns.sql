-- =====================================================================
-- 0225 — close the "self-edit any column" gap in profiles_update.
--
-- profiles_update's self-edit clause (0001_init.sql, unchanged through
-- 0144/0150/0206) is `firebase_uid = jwt sub` with NO column restriction —
-- RLS is row-level only, so any logged-in user could currently PATCH their
-- OWN row's `role`, `extra_roles`, `is_active`, `frozen`, `branch_access`,
-- `employment_type`, `company_id`, etc. via a raw REST call, none of which
-- the app's own UI ever exposes to a non-admin self-edit. Every legitimate
-- self-edit path was audited (profile.tsx "My Profile", plus the
-- last-login/presence heartbeats and must-change-password self-clear in
-- users.ts) to build the allow-list below — see that audit's findings in
-- the PR/commit this migration ships with.
--
-- Deliberately a BEFORE UPDATE trigger, not a column-level GRANT/REVOKE:
-- grants aren't row-aware, and the SAME columns (role, is_active,
-- extra_roles, branch_access, employment_type, manager_name, ...) are
-- legitimately writable by ADMIN/HR/FINANCE/SuperAdmin editing SOMEONE
-- ELSE'S row (already gated by profiles_update's admin-tier clause +
-- can_edit_profile_row()) — a table-wide REVOKE would break that too. This
-- trigger only ever adds restriction on the "editing MY OWN row" case;
-- editing another profile is untouched and still relies entirely on the
-- existing RLS policy.
--
-- Run once in the Supabase SQL Editor, after 0224.
-- =====================================================================

create or replace function restrict_profile_self_edit_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_self boolean;
  my_role text;
begin
  -- `and`, not just `old.id = auth_profile_id()` alone — a NULL
  -- auth_profile_id() (service-role / no JWT context, e.g. setProfileFrozen
  -- called by HR freezing someone, or the login/presence heartbeat writes
  -- in users.ts) must resolve to a real FALSE here, not NULL, or the
  -- `if not is_self` check below would (wrongly) fall through into the
  -- self-edit restrictions for those non-self, already-trusted writes.
  is_self := (auth_profile_id() is not null) and (old.id = auth_profile_id());
  if not is_self then
    return new;
  end if;

  my_role := old.role; -- the caller's OWN role as of BEFORE this edit

  -- Role — mirrors profile.tsx's ACCOUNT_FIELD_EDIT_ROLES exactly (primary
  -- role only, same as the UI gate — NOT extra_roles-inclusive like
  -- is_admin()/is_hr(), since that would be more permissive than what the
  -- UI itself currently allows).
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

  -- must_change_password — only the self-clear direction (clearMyMustChangePassword,
  -- called right after a successful self-service password change) has a
  -- real use; the reverse has none and would just be a weird self-lock.
  if new.must_change_password is distinct from old.must_change_password
     and new.must_change_password = true then
    raise exception 'Cannot set your own must-change-password flag.';
  end if;

  -- frozen — the ONLY self-edit direction with a real use is the
  -- auto-unfreeze check in signableDocuments.ts's signDocument (runs as
  -- the technician who just signed, right after confirming server-side —
  -- via getIncompleteTechnicianForms reading real hr_signable_documents/
  -- technician_form_exemptions rows, not a client-trusted flag — that
  -- every required form is actually done). The reverse (false -> true) and
  -- frozen_at/frozen_by/frozen_by_name have no self-edit case at all — only
  -- HR/an admin freezing someone ELSE writes those, which never reaches
  -- this branch.
  if new.frozen is distinct from old.frozen
     and not (old.frozen = true and new.frozen = false) then
    raise exception 'You do not have permission to change your own frozen status.';
  end if;
  if new.frozen_at is distinct from old.frozen_at
     or new.frozen_by is distinct from old.frozen_by
     or new.frozen_by_name is distinct from old.frozen_by_name then
    raise exception 'You do not have permission to change that field on your own account.';
  end if;

  -- Always-safe self-service fields — no restriction beyond the checks
  -- above: display_name, email, phone_number, department, assigned_branch,
  -- po_initials, working_hours, meal_minutes, last_login, presence_seen_at,
  -- presence_active_at (all confirmed real self-edit call sites in
  -- profile.tsx / users.ts's heartbeat functions), plus a second tier of
  -- low-stakes contact/notification-routing metadata that carries no
  -- access-control weight even though no self-edit UI currently touches
  -- it (email_report_location, sms_status, work_plan, personal_email,
  -- work_phone, tier_level, staff_note) — blocking these would risk
  -- breaking a legitimate HR/manager editing their OWN roster row from
  -- StaffListPage.tsx/ReportHRDaily.tsx for negligible security benefit,
  -- since none of them gate what a user can access or do.

  -- Everything else has NO legitimate self-edit call site anywhere in the
  -- app today AND is either access/permission-determining or an integrity/
  -- audit field — block outright rather than silently allowing whatever a
  -- future column addition might bring along. Includes columns that are
  -- written server-side only via the service-role key (last_login_ip,
  -- failed_login_count, locked_until, current_session_id) — those bypass
  -- RLS entirely so this trigger never actually applies to them in
  -- practice, but they're listed for completeness/defense in depth.
  if new.extra_roles is distinct from old.extra_roles
     or new.is_active is distinct from old.is_active
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

drop trigger if exists trg_restrict_profile_self_edit on profiles;
create trigger trg_restrict_profile_self_edit
  before update on profiles
  for each row execute function restrict_profile_self_edit_columns();
