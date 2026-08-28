-- Restores a working path for the "Complete Employer Signature" flow
-- (ReportHRDaily.tsx's per-type dialogs and EmployerSignBundlePage.tsx's
-- Bulk Sign), which has been silently broken since migration 0100 dropped
-- the is_superadmin() bypass from hr_signable_documents_update without
-- replacing it with anything company-admin-scoped.
--
-- The real-world flow: HR person A sends a document to an employee
-- (created_by = A, recipient_id = employee). Once the employee signs, ANY
-- HR/Admin staffer may need to add the employer signature and confirm --
-- not necessarily person A specifically. Since 0100, the policy only
-- allowed the exact recipient or exact creator to update a row, so every
-- write from a different HR/Admin user silently matched zero rows (RLS
-- filters rows out rather than raising a permission error, so the app
-- had no way to know the write never happened).
--
-- Adds a company-scoped admin/HR/company-superadmin bypass, matching the
-- same three-role combination the app's own HR Dashboard access gate uses
-- (DASHBOARD_ROLE_GATES["hr-dashboard"] = ["ADMIN", "HR"], plus the
-- company-scoped SUPERADMIN tier per its "same tier as ADMIN" status --
-- see is_company_superadmin(), migration 0099). This is narrower than the
-- old is_superadmin() bypass 0100 removed: that was the platform-level
-- SUPERSUPERADMIN role with no company scoping at all; this is
-- company_id = auth_company_id() AND one of these three roles, so it
-- can't reach across companies the way the old bypass could.
drop policy if exists hr_signable_documents_update on hr_signable_documents;
create policy hr_signable_documents_update on hr_signable_documents
  for update using (
    recipient_id = auth_profile_id()
    or created_by = auth_profile_id()
    or (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
  )
  with check (
    recipient_id = auth_profile_id()
    or created_by = auth_profile_id()
    or (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
  );
