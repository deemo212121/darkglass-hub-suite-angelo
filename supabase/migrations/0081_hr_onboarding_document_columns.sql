-- =====================================================================
-- 0081 — Custom columns for the Onboarding Documents checklist grid
--
-- The Technician/Parts Manager/Philippines document lists are hardcoded
-- in ReportHRDaily.tsx (TECHNICIAN_ONBOARDING_DOCS etc.). This table lets
-- HR add extra columns from the UI, per group, without a code change —
-- merged with those hardcoded defaults at render time.
--
-- A custom column behaves exactly like a hardcoded one: onboarding_documents
-- .category is already free text (see 0048), so YES/NO for a custom column
-- is driven by the same getOnboardingDocumentCategoriesByProfileIds lookup
-- everything else uses, and the per-employee Documents page gets one more
-- upload/link drop zone for it automatically.
--
-- Run once in the Supabase SQL Editor, after 0080.
-- =====================================================================

create table if not exists hr_onboarding_document_columns (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  group_key   text not null check (group_key in ('TECHNICIAN', 'PARTS_MANAGER', 'PH')),
  label       text not null,
  sort_order  bigint not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists idx_hr_onboarding_document_columns_unique
  on hr_onboarding_document_columns(company_id, group_key, label);
create index if not exists idx_hr_onboarding_document_columns_group
  on hr_onboarding_document_columns(company_id, group_key, sort_order);

create or replace function hr_onboarding_document_columns_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_onboarding_document_columns_stamp on hr_onboarding_document_columns;
create trigger trg_hr_onboarding_document_columns_stamp before insert on hr_onboarding_document_columns
  for each row execute function hr_onboarding_document_columns_stamp();

-- ---------- RLS ----------
alter table hr_onboarding_document_columns enable row level security;
alter table hr_onboarding_document_columns force row level security;

drop policy if exists hr_onboarding_document_columns_select on hr_onboarding_document_columns;
create policy hr_onboarding_document_columns_select on hr_onboarding_document_columns
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_onboarding_document_columns_insert on hr_onboarding_document_columns;
create policy hr_onboarding_document_columns_insert on hr_onboarding_document_columns
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_onboarding_document_columns_delete on hr_onboarding_document_columns;
create policy hr_onboarding_document_columns_delete on hr_onboarding_document_columns
  for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- Realtime ----------
do $$
begin
  alter publication supabase_realtime add table hr_onboarding_document_columns;
exception when duplicate_object then
  raise notice 'hr_onboarding_document_columns already in supabase_realtime publication';
end $$;
