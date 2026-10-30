-- =====================================================================
-- 0418 — Employee files (paystubs): Accounting → Paystubs uploads a pay
-- run's check stubs in bulk (one PDF, one page per employee), each page is
-- matched to an account by the payee name and confirmed by Accounting, and
-- the confirmed ones show on that employee's Employee Self-Service → My
-- Files.
--
--   * employee_files: one row per file (a single stub page). profile_id is
--     null while a page is still unassigned. status: 'unassigned' (kept,
--     not matched to anyone yet), 'published' (the employee sees it),
--     'withdrawn' (taken back — kept for the record, hidden from them).
--   * Bucket 'employee-files' (private), path {company_id}/{batch_id}/...
--     The file is read through a short-lived signed URL; creating one needs
--     select on the object, so the storage policy asks the same question as
--     the table: Accounting / HR / Admin of the company, or the employee
--     the file is published to. A link to someone else's paystub can't be
--     made, whatever the path.
--
-- Managing = Finance, HR, Admin or SuperAdmin (main or extra role).
-- Safe to run again. Run once in the Supabase SQL Editor (Run without RLS).
-- =====================================================================

create or replace function is_employee_files_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select is_finance() or is_hr() or is_admin() or is_company_superadmin() or is_superadmin();
$$;

create table if not exists employee_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  kind text not null default 'paystub',
  title text not null,
  pay_date date,
  period_start date,
  period_end date,
  storage_path text not null unique,
  -- Upload batch: one bulk upload, so a whole run can be found together.
  batch_id uuid not null,
  source_file_name text,
  source_page integer,
  -- What was read off the page (OCR) and how it matched — the review record.
  name_on_file text,
  match_note text,
  status text not null default 'unassigned' check (status in ('unassigned', 'published', 'withdrawn')),
  uploaded_by uuid references profiles(id) on delete set null,
  uploaded_by_name text,
  uploaded_at timestamptz not null default now(),
  confirmed_by uuid references profiles(id) on delete set null,
  confirmed_by_name text,
  published_at timestamptz,
  withdrawn_by_name text,
  withdrawn_at timestamptz,
  check (status <> 'published' or profile_id is not null)
);

create index if not exists employee_files_profile_idx on employee_files (profile_id, status);
create index if not exists employee_files_company_pay_date_idx on employee_files (company_id, pay_date desc);
create index if not exists employee_files_batch_idx on employee_files (batch_id);

alter table employee_files enable row level security;

drop policy if exists employee_files_select on employee_files;
create policy employee_files_select on employee_files
  for select using (
    company_id = auth_company_id()
    and (is_employee_files_admin() or (profile_id = auth_profile_id() and status = 'published'))
  );

drop policy if exists employee_files_insert on employee_files;
create policy employee_files_insert on employee_files
  for insert with check (company_id = auth_company_id() and is_employee_files_admin());

drop policy if exists employee_files_update on employee_files;
create policy employee_files_update on employee_files
  for update using (company_id = auth_company_id() and is_employee_files_admin())
              with check (company_id = auth_company_id() and is_employee_files_admin());

drop policy if exists employee_files_delete on employee_files;
create policy employee_files_delete on employee_files
  for delete using (company_id = auth_company_id() and is_employee_files_admin());

-- Storage ---------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('employee-files', 'employee-files', false)
on conflict (id) do nothing;

drop policy if exists employee_files_objects_select on storage.objects;
create policy employee_files_objects_select on storage.objects
  for select using (
    bucket_id = 'employee-files'
    and (storage.foldername(name))[1] = (auth_company_id())::text
    and (
      is_employee_files_admin()
      or exists (
        select 1 from employee_files f
        where f.storage_path = storage.objects.name
          and f.profile_id = auth_profile_id()
          and f.status = 'published'
      )
    )
  );

drop policy if exists employee_files_objects_insert on storage.objects;
create policy employee_files_objects_insert on storage.objects
  for insert with check (
    bucket_id = 'employee-files'
    and (storage.foldername(name))[1] = (auth_company_id())::text
    and is_employee_files_admin()
  );

drop policy if exists employee_files_objects_delete on storage.objects;
create policy employee_files_objects_delete on storage.objects
  for delete using (
    bucket_id = 'employee-files'
    and (storage.foldername(name))[1] = (auth_company_id())::text
    and is_employee_files_admin()
  );
