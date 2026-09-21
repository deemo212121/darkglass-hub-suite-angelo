-- =====================================================================
-- 0295 — Branch tab on Recruitment Site (HR Dashboard): a simple per-
-- branch Open/Closed-for-posting toggle, NOT a job posting — every real
-- branch is listed (from the same LOCATIONS_DATA/branchOptions every
-- other branch dropdown in this app already uses), each with just an
-- open/closed setting. Unrelated to hr_job_postings (0294) — that table
-- and this one are two different concepts, not variants of each other.
--
-- No row for a branch = open by default (a branch only needs a row once
-- someone explicitly closes it, or reopens a closed one) — the app lists
-- every branch regardless of whether it has a row here yet.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as ebay_orders/ebay_listings (0280).
-- Run once in the Supabase SQL Editor, after 0294.
-- =====================================================================

create table if not exists hr_branch_posting_status (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  branch      text not null,
  is_open     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, branch)
);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function hr_branch_posting_status_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_hr_branch_posting_status_stamp on hr_branch_posting_status;
create trigger trg_hr_branch_posting_status_stamp before insert or update on hr_branch_posting_status
  for each row execute function hr_branch_posting_status_stamp();

-- ---------- RLS: company-scoped, same pattern as ebay_orders (0280) ----------
alter table hr_branch_posting_status enable row level security;
alter table hr_branch_posting_status force row level security;

drop policy if exists hr_branch_posting_status_select on hr_branch_posting_status;
create policy hr_branch_posting_status_select on hr_branch_posting_status
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists hr_branch_posting_status_insert on hr_branch_posting_status;
create policy hr_branch_posting_status_insert on hr_branch_posting_status
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists hr_branch_posting_status_update on hr_branch_posting_status;
create policy hr_branch_posting_status_update on hr_branch_posting_status
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists hr_branch_posting_status_delete on hr_branch_posting_status;
create policy hr_branch_posting_status_delete on hr_branch_posting_status
  for delete using (company_id = auth_company_id() or is_superadmin());
