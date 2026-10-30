-- =====================================================================
-- 0417 — HR Paperworks: only its people can delete a paper.
--
-- At AH Solutions, HR → HR Paperworks is limited to Wincel Franz Carusca,
-- Shin Seo (Angella) and Justin Lee, plus Super Admin
-- (src/lib/hrPaperworksAccess.ts). Everyone else may still read the papers,
-- but deleting one was open to every signed-in user of the company
-- (hr_signable_documents_delete, 0100). Now only those three and Super
-- Admin (main or secondary role) can delete one there. Every delete in the
-- app is on the HR Paperworks page, so nothing else changes.
--
-- Reading, sending and signing are unchanged; other companies keep the
-- 0100 rule. Keep the three profile ids in step with hrPaperworksAccess.ts.
--
-- Policy change only — no data changes. Safe to run again.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create or replace function can_delete_hr_paperworks(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_company_id <> 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd'::uuid  -- not AH Solutions: unchanged
    or is_company_superadmin()
    or auth_profile_id() in (
      '18ca4ceb-5fca-43f3-b25c-9e5e7f45e40a'::uuid,  -- Wincel Franz Carusca
      '4497efc2-75a4-4cac-bede-bb24ba290675'::uuid,  -- Shin Seo (Angella)
      '6ee95872-1f1c-4a0e-95c3-4221a388ff14'::uuid   -- Justin Lee
    );
$$;

drop policy if exists hr_signable_documents_delete on hr_signable_documents;
create policy hr_signable_documents_delete on hr_signable_documents for delete
  using (company_id = auth_company_id() and can_delete_hr_paperworks(company_id));
