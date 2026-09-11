-- =====================================================================
-- 0224 — let a technician read their OWN technician_form_exemptions rows
-- (still nobody else's) — needed for the frozen-account "which forms do
-- I still need to sign" popup (FrozenAccountModal.tsx via
-- technicianFormStatus.ts): without this, a plain technician's read of
-- the table is blocked entirely by 0222's ADMIN/HR-only select policy, so
-- a form they've been marked Not Applicable for would incorrectly show
-- up in their own "still needed" list. HR/Admin/company-superadmin/
-- superadmin visibility (0222) is unchanged.
--
-- Run once in the Supabase SQL Editor, after 0223.
-- =====================================================================

drop policy if exists technician_form_exemptions_select on technician_form_exemptions;
create policy technician_form_exemptions_select on technician_form_exemptions
  for select using (
    (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
    or is_superadmin()
    or profile_id = auth_profile_id()
  );
