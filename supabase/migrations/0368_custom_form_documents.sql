-- =====================================================================
-- 0368 — Custom Forms: saved documents and company-side completion.
--
-- 1. hr_custom_form_submissions gets:
--      pdf_url / pdf_generated_at — the finished document, saved to Storage
--        once a submission is done (CustomFormsPanel / FillCustomFormPage).
--      completed_at / completed_by — when HR filled in a form's "Filled in
--        by: Company" fields (e.g. an Authorized Representative signature).
-- 2. The "Acknowledgment of Wage & Compensation Structure" form's document
--    template pointed at a field named "longtext" that doesn't exist, so its
--    PDF never showed the acknowledgment text — repointed at the form's own
--    paragraph.
--
-- Adds columns and fixes one template reference — no data is removed.
-- Run once in the Supabase SQL Editor, after 0367.
-- =====================================================================

alter table hr_custom_form_submissions add column if not exists pdf_url text;
alter table hr_custom_form_submissions add column if not exists pdf_generated_at timestamptz;
alter table hr_custom_form_submissions add column if not exists completed_at timestamptz;
alter table hr_custom_form_submissions add column if not exists completed_by uuid references profiles(id);

update hr_custom_forms f
set document_template = jsonb_set(
  f.document_template,
  '{blocks}',
  (
    select jsonb_agg(
      case when b->>'fieldName' = 'longtext' then b || '{"fieldName": "paragraph", "showLabel": false}'::jsonb else b end
      order by ord
    )
    from jsonb_array_elements(f.document_template->'blocks') with ordinality as t(b, ord)
  )
)
where f.id = '95df0581-419c-494c-8f24-40f2facf6be8'
  and f.document_template->'blocks' @> '[{"fieldName": "longtext"}]'::jsonb;

notify pgrst, 'reload schema';
