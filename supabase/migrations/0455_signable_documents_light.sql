-- =====================================================================
-- 0455 — Lighter HR form lists (speed only — no data is changed).
--
-- hr_signable_documents rows carry the signature IMAGES twice: inside
-- form_data (signatureDataUrl, employeeSignatureDataUrl, employerSignature…
-- — every key ending in "DataUrl") and as signatures.<slot>.url. Pages that
-- only LIST forms (who, status, dates, PDF link) were downloading all of
-- those images every time.
--
-- This view is the same table, same rows, same columns — with only those
-- images left out. Read-only. It runs as the signed-in person
-- (security_invoker), so the table's own row-level security still decides
-- what each person sees — exactly as before.
--
-- Used by: Exceeded → Time Corrections, Flash Tech Calendar, Onboarding
-- Applicant Documents, Technician Whereabouts, and Home's counts. Opening /
-- signing / editing a form still reads the full row from the table.
-- If this view is missing the app falls back to the table, so nothing breaks
-- before it's run.
--
-- Safe to run again. Run once in the Supabase SQL Editor.
-- =====================================================================

create or replace view hr_signable_documents_light
with (security_invoker = true) as
select
  d.id,
  d.company_id,
  d.document_type,
  -- every answer except the "...DataUrl" signature images
  (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(d.form_data) = 'object' then d.form_data else '{}'::jsonb end) as e(key, value)
    where e.key not like '%DataUrl'
  ) as form_data,
  -- who signed and when, without the signature image
  (
    select coalesce(jsonb_object_agg(s.key, case when jsonb_typeof(s.value) = 'object' then s.value - 'url' else s.value end), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(d.signatures) = 'object' then d.signatures else '{}'::jsonb end) as s(key, value)
  ) as signatures,
  d.status,
  d.recipient_id,
  d.recipient_name,
  d.recipient_slot,
  d.pdf_url,
  d.agent_note_id,
  d.created_by,
  d.created_at,
  d.signed_at,
  d.confirmed_at,
  d.cancelled_at
from hr_signable_documents d;

grant select on hr_signable_documents_light to authenticated;

notify pgrst, 'reload schema';
