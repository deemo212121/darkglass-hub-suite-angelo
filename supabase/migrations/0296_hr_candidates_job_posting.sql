-- =====================================================================
-- 0296 — Link a candidate to the Recruitment Site job posting they came
-- from (hr_job_postings, migration 0294). Optional — Add Candidate's new
-- "Job Posting" dropdown lets HR pick one, but nothing requires it.
--
-- Run once in the Supabase SQL Editor, after 0294.
-- =====================================================================

alter table hr_candidates add column if not exists job_posting_id uuid references hr_job_postings(id) on delete set null;
create index if not exists idx_hr_candidates_job_posting on hr_candidates(job_posting_id);
