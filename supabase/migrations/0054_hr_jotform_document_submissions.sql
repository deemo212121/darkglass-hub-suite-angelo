-- =====================================================================
-- 0054 — Jotform Document submissions (real generated PDF, not just
-- answer text)
--
-- Replaces the old "Jotform Submissions" tab's Firestore-only notification
-- ping with a proper Supabase-backed record per submission, so it can be
-- filtered/sorted/searched the same way every other HR list in this app is
-- (see hr_candidates, hr_signable_documents) instead of living only in a
-- Firestore notification doc.
--
-- One row per Jotform submission. `document_url`/`document_path` point at
-- the exact PDF Jotform generated for that submission (fetched via their
-- generatePDF API and re-hosted in Firebase Storage — see
-- src/lib/server/jotformBridge.ts), not something we re-created ourselves.
-- `submission_id` is unique per company so a retried webhook delivery
-- upserts the same row instead of duplicating it.
--
-- Run once in the Supabase SQL Editor, after 0053.
-- =====================================================================

create table if not exists hr_jotform_submissions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  form_id         text not null,
  form_title      text,
  submission_id   text not null,
  applicant_name  text,
  document_url    text,
  document_path   text,
  status          text not null default 'new' check (status in ('new', 'reviewed', 'archived')),
  submitted_at    timestamptz not null,
  created_at      timestamptz not null default now(),
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  unique (company_id, submission_id)
);
create index if not exists idx_hr_jotform_submissions_company on hr_jotform_submissions(company_id, submitted_at desc);
create index if not exists idx_hr_jotform_submissions_status on hr_jotform_submissions(company_id, status);

create or replace function hr_jotform_submissions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_jotform_submissions_stamp on hr_jotform_submissions;
create trigger trg_hr_jotform_submissions_stamp before insert on hr_jotform_submissions
  for each row execute function hr_jotform_submissions_stamp();

-- ---------- RLS ----------
-- Rows are written by the Jotform webhook using the Supabase service-role
-- key (bypasses RLS entirely, company_id supplied explicitly) — these
-- policies matter for the HR dashboard's own reads/status updates.
alter table hr_jotform_submissions enable row level security;
alter table hr_jotform_submissions force row level security;

drop policy if exists hr_jotform_submissions_select on hr_jotform_submissions;
create policy hr_jotform_submissions_select on hr_jotform_submissions
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_jotform_submissions_insert on hr_jotform_submissions;
create policy hr_jotform_submissions_insert on hr_jotform_submissions
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_jotform_submissions_update on hr_jotform_submissions;
create policy hr_jotform_submissions_update on hr_jotform_submissions
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_jotform_submissions_delete on hr_jotform_submissions;
create policy hr_jotform_submissions_delete on hr_jotform_submissions
  for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- Realtime ----------
do $$
begin
  alter publication supabase_realtime add table hr_jotform_submissions;
exception when duplicate_object then
  raise notice 'hr_jotform_submissions already in supabase_realtime publication';
end $$;
