-- =====================================================================
-- 0042 — HR Candidates: hiring-pipeline fields + candidate CV storage
--
-- Ported from upstream (janeyyy16/usapp)'s 0030_hr_candidates.sql,
-- renumbered to 0042 (see 0040_csr_agent_notes.sql for why).
--
-- `hr_candidates` already exists from 0001_init.sql (full_name, position,
-- branch_location_id, stage, interview_date, notes, created_by,
-- created_at) with RLS + a company_id auto-stamp trigger already applied
-- generically via that file's tenant_tables loop — nothing in this
-- codebase ever built a feature on top of it, so this migration extends
-- it rather than replacing it:
--   - `branch` (free text) is added alongside the unused `branch_location_id`
--     FK, to match how every other branch-scoped view in this app works
--     (free-text location names from LOCATIONS_DATA, not a locations-table
--     join — see CSRTeamLeaderDashboard.tsx, ReportCSRDaily.tsx, etc.)
--   - `phone`, `email`, `cv_path` are new — the original schema had none.
--   - `status` is a new, separate column from the legacy `stage` (whose
--     check constraint mixes in post-hire states like 'warned'/'terminated'
--     that don't fit a candidate pipeline) — `stage` is left untouched/unused.
--   - `updated_at` is new, touched by its own trigger below.
--
-- Run once in the Supabase SQL Editor, after 0041.
-- =====================================================================

alter table hr_candidates
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists branch text,
  add column if not exists cv_path text,
  add column if not exists status text not null default 'applied' check (status in ('applied', 'interviewing', 'selected', 'hired', 'rejected')),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_hr_candidates_branch on hr_candidates(company_id, branch);

-- company_id is already auto-stamped by 0001_init.sql's generic
-- trg_hr_candidates_company trigger — this one only adds created_by,
-- which that trigger doesn't touch.
create or replace function hr_candidates_stamp_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then
    new.created_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_candidates_created_by on hr_candidates;
create trigger trg_hr_candidates_created_by before insert on hr_candidates
  for each row execute function hr_candidates_stamp_created_by();

create or replace function hr_candidates_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_hr_candidates_touch on hr_candidates;
create trigger trg_hr_candidates_touch before update on hr_candidates
  for each row execute function hr_candidates_touch_updated_at();

-- ---------- Storage: private bucket for candidate CVs ----------
-- Object path convention: {company_id}/{candidate_id}/{filename} — the
-- policies below key off the first path segment to scope access the same
-- way hr_candidates rows are scoped.
insert into storage.buckets (id, name, public)
values ('candidate-cvs', 'candidate-cvs', false)
on conflict (id) do nothing;

drop policy if exists candidate_cvs_select on storage.objects;
create policy candidate_cvs_select on storage.objects
  for select using (
    bucket_id = 'candidate-cvs'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );

drop policy if exists candidate_cvs_insert on storage.objects;
create policy candidate_cvs_insert on storage.objects
  for insert with check (
    bucket_id = 'candidate-cvs'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );

drop policy if exists candidate_cvs_delete on storage.objects;
create policy candidate_cvs_delete on storage.objects
  for delete using (
    bucket_id = 'candidate-cvs'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );
