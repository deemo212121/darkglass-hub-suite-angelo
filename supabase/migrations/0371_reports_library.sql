-- =====================================================================
-- 0371 — Reports Library (Admin → Reports Library).
--
-- Imported spreadsheet reports (HR's Attendance & Leave reports, leave
-- dashboards, ...) shown inside AHS for leadership — kept COMPLETELY apart
-- from live data: these two tables are never read by attendance, PTO,
-- payroll or any other page, and nothing here writes anywhere else.
--
--   executive_reports       one row per uploaded file: title, period,
--                           source, and each sheet's cells (sheets jsonb)
--                           as read at upload time.
--   executive_report_files  the original file (base64) for Download —
--                           separate so the list never loads file bytes.
--
-- Access: Admin and SuperAdmin of the same company only — read, add and
-- delete. Enforced here (RLS), not just by hiding the page.
--
-- New tables only — nothing existing is changed.
-- Run once in the Supabase SQL Editor, after 0370.
-- =====================================================================

create table if not exists executive_reports (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  title        text not null,
  period       text,
  source       text,
  notes        text,
  file_name    text not null,
  file_type    text,
  file_size    integer,
  sheets       jsonb not null default '[]'::jsonb,
  uploaded_by  uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_executive_reports_company on executive_reports(company_id, created_at desc);

create table if not exists executive_report_files (
  report_id    uuid primary key references executive_reports(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  file_base64  text not null
);

create or replace function executive_reports_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then new.company_id := auth_company_id(); end if;
  if tg_table_name = 'executive_reports' and new.uploaded_by is null then new.uploaded_by := auth_profile_id(); end if;
  return new;
end;
$$;

drop trigger if exists trg_executive_reports_stamp on executive_reports;
create trigger trg_executive_reports_stamp before insert on executive_reports
  for each row execute function executive_reports_stamp();

drop trigger if exists trg_executive_report_files_stamp on executive_report_files;
create trigger trg_executive_report_files_stamp before insert on executive_report_files
  for each row execute function executive_reports_stamp();

-- ---------- RLS: same-company Admin / SuperAdmin only ----------
alter table executive_reports enable row level security;
alter table executive_reports force row level security;
alter table executive_report_files enable row level security;
alter table executive_report_files force row level security;

drop policy if exists executive_reports_select on executive_reports;
create policy executive_reports_select on executive_reports
  for select using (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));
drop policy if exists executive_reports_insert on executive_reports;
create policy executive_reports_insert on executive_reports
  for insert with check (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));
drop policy if exists executive_reports_update on executive_reports;
create policy executive_reports_update on executive_reports
  for update using (company_id = auth_company_id() and (is_admin() or is_company_superadmin()))
              with check (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));
drop policy if exists executive_reports_delete on executive_reports;
create policy executive_reports_delete on executive_reports
  for delete using (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));

drop policy if exists executive_report_files_select on executive_report_files;
create policy executive_report_files_select on executive_report_files
  for select using (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));
drop policy if exists executive_report_files_insert on executive_report_files;
create policy executive_report_files_insert on executive_report_files
  for insert with check (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));
drop policy if exists executive_report_files_delete on executive_report_files;
create policy executive_report_files_delete on executive_report_files
  for delete using (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));

notify pgrst, 'reload schema';
