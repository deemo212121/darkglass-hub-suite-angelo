-- Which onboarding form TYPES apply to a given candidate — HR picks these
-- via a checkbox popup on the Hiring table's new "Forms" column
-- (ReportHRDaily.tsx), which then shows "X/Y complete" for that candidate
-- (Y = how many types are checked here, X = how many of those types have
-- a signed/confirmed hr_signable_documents row for the matching profile,
-- resolved by email the same way the Account Status column already does).
-- No fixed "every new hire needs these N forms" list exists anywhere in
-- this app — it genuinely varies by position/branch, hence a per-candidate
-- selection rather than one global required-forms list.

create table if not exists hr_candidate_required_forms (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  candidate_id uuid not null references hr_candidates(id) on delete cascade,
  document_type text not null,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (candidate_id, document_type)
);

-- Same simple company-scoped access hr_candidates itself already has (via
-- the tenant_tables RLS loop in 0001_init.sql) — not narrowed to a
-- specific role here either, matching that precedent.
alter table hr_candidate_required_forms enable row level security;
alter table hr_candidate_required_forms force row level security;

create policy hr_candidate_required_forms_select on hr_candidate_required_forms
  for select using (company_id = auth_company_id() or is_superadmin());
create policy hr_candidate_required_forms_insert on hr_candidate_required_forms
  for insert with check (company_id = auth_company_id() or is_superadmin());
create policy hr_candidate_required_forms_delete on hr_candidate_required_forms
  for delete using (company_id = auth_company_id() or is_superadmin());

-- Auto-stamps company_id from the parent candidate row so the client never
-- has to pass it explicitly (and can't spoof it to another company's id).
create or replace function hr_candidate_required_forms_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from hr_candidates where id = new.candidate_id;
  return new;
end;
$$;

drop trigger if exists hr_candidate_required_forms_stamp_trigger on hr_candidate_required_forms;
create trigger hr_candidate_required_forms_stamp_trigger
  before insert on hr_candidate_required_forms
  for each row execute function hr_candidate_required_forms_stamp();
