-- =====================================================================
-- 0222 — technician_form_exemptions: "this technician doesn't need this
-- form" flag for the HR module's Technician Form Checklist
-- (TechnicianFormChecklistPage.tsx). A row present = marked Not
-- Applicable; no row = still expected. Excluded from the checklist's
-- done/total count once marked, so an exempted form never shows as
-- missing. Same shape/RLS pattern as employee_onboarding_tasks (0220).
--
-- Run once in the Supabase SQL Editor, after 0221.
-- =====================================================================

create table if not exists technician_form_exemptions (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  document_type   text not null,
  marked_by       uuid references profiles(id) on delete set null,
  marked_by_name  text,
  created_at      timestamptz not null default now(),
  unique (company_id, profile_id, document_type)
);

create index if not exists idx_technician_form_exemptions_company
  on technician_form_exemptions (company_id, profile_id);

create or replace function technician_form_exemptions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.marked_by is null then
    new.marked_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_technician_form_exemptions_stamp on technician_form_exemptions;
create trigger trg_technician_form_exemptions_stamp
  before insert on technician_form_exemptions
  for each row execute function technician_form_exemptions_stamp();

-- ---------- RLS — same ADMIN/HR/company-superadmin/superadmin audience as employee_onboarding_tasks ----------
alter table technician_form_exemptions enable row level security;
alter table technician_form_exemptions force row level security;

drop policy if exists technician_form_exemptions_select on technician_form_exemptions;
create policy technician_form_exemptions_select on technician_form_exemptions
  for select using (
    (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists technician_form_exemptions_write on technician_form_exemptions;
create policy technician_form_exemptions_write on technician_form_exemptions
  for all
  using (
    (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
    or is_superadmin()
  )
  with check (
    (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
    or is_superadmin()
  );
