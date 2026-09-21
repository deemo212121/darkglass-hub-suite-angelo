-- =====================================================================
-- 0294 — Recruitment Site tab (HR Dashboard): a manually-kept mirror of
-- HR's real ZipRecruiter/Indeed job postings (title, location, candidate
-- counts, sponsored plan + cost, date posted, assignee, Open/Paused/
-- Closed status) — same "type in what the external site shows" pattern
-- as ebay_orders (0280) and the Claims Daily Report (0293), not computed
-- from hr_candidates (there's no existing job-posting concept to attach
-- candidate counts to, and the external site's own numbers wouldn't match
-- an internal count anyway).
--
-- One table, no report_date — postings stay open for weeks, so this is a
-- live ongoing list, not a daily snapshot.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as ebay_orders/ebay_listings (0280).
-- Run once in the Supabase SQL Editor, after 0293.
-- =====================================================================

create table if not exists hr_job_postings (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  platform         text not null check (platform in ('zip_recruiter', 'indeed')),
  job_title        text not null default 'New Job Posting',
  location         text,
  candidates_all   integer not null default 0,
  candidates_new   integer not null default 0,
  sponsored_plan   text,
  cost_daily       numeric,
  cost_total       numeric,
  date_posted      date,
  assignee_id      uuid references profiles(id) on delete set null,
  status           text not null default 'open' check (status in ('open', 'paused', 'closed')),
  starred          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_hr_job_postings_company_platform on hr_job_postings(company_id, platform);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function hr_job_postings_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_hr_job_postings_stamp on hr_job_postings;
create trigger trg_hr_job_postings_stamp before insert or update on hr_job_postings
  for each row execute function hr_job_postings_stamp();

-- ---------- RLS: company-scoped, same pattern as ebay_orders (0280) ----------
alter table hr_job_postings enable row level security;
alter table hr_job_postings force row level security;

drop policy if exists hr_job_postings_select on hr_job_postings;
create policy hr_job_postings_select on hr_job_postings
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists hr_job_postings_insert on hr_job_postings;
create policy hr_job_postings_insert on hr_job_postings
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists hr_job_postings_update on hr_job_postings;
create policy hr_job_postings_update on hr_job_postings
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists hr_job_postings_delete on hr_job_postings;
create policy hr_job_postings_delete on hr_job_postings
  for delete using (company_id = auth_company_id() or is_superadmin());
