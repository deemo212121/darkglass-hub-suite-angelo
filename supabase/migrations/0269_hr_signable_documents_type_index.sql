-- =====================================================================
-- 0269 — Index hr_signable_documents(company_id, document_type)
--
-- 0050 indexed (recipient_id, status) and (company_id) alone, but every
-- getSignableDocuments[ByTypes]() call (Staff Form Checklist's per-tab
-- load, Hiring's forms column, the Universal Activity Log, etc.) filters
-- by company_id AND document_type together -- worst case for the
-- Technician tab, which queries 16 document types in one .in() call.
-- Without this, Postgres can use the company_id index to narrow to this
-- company's rows but still has to scan all of them sequentially to apply
-- the document_type filter. Purely additive -- no behavior change, just
-- lets that second filter use an index too.
--
-- Run once in the Supabase SQL Editor, after 0268.
-- =====================================================================

create index if not exists idx_hr_signable_documents_company_type on hr_signable_documents(company_id, document_type);
