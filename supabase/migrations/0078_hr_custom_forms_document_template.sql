-- =====================================================================
-- 0078 — "Turn submissions into documents": an optional PDF template per
-- custom form (see supabase/migrations/0077_hr_custom_forms.sql).
--
-- One template per form (1:1), so it's just one nullable jsonb column
-- rather than a new table — src/lib/documentTemplates/types.ts's
-- DocumentTemplate shape ({ blocks: DocumentBlock[] }). Null means "no
-- document designed yet", the common case.
--
-- The PDF itself is never generated or stored server-side — it's built
-- on demand in HR's own browser from this template + a submission's
-- stored responses (captureHtmlToPdfBlob needs a real DOM/canvas, so it
-- can't run in the serverless custom-forms webhook). Nothing here changes
-- how submissions are written, so no other table is touched.
--
-- Run once in the Supabase SQL Editor, after 0077.
-- =====================================================================

alter table hr_custom_forms add column if not exists document_template jsonb;
