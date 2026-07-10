-- =====================================================================
-- 0048 — Onboarding Documents: per-applicant document repository
--
-- Actual files (Resume, IDs, Medical, etc.) live in Firebase Storage, not
-- here — this table is purely the "which file belongs to which applicant's
-- which category" metadata (filename + Firebase download URL + storage
-- path for deletion), so no Supabase Storage bucket/quota is involved.
--
-- `category` is free text, not a fixed enum — it's the applicant's actual
-- required-document name (e.g. "W9", "Driver's License", "Vehicle Use
-- Agreement"), which varies by role (Technician / Parts Manager /
-- Philippines each have their own checklist — see the *_ONBOARDING_DOCS
-- arrays in ReportHRDaily.tsx). Same free-text treatment as position/branch
-- elsewhere in this schema, rather than a check constraint that would need
-- editing every time a role's checklist changes.
--
-- Files can arrive two ways: dragged in from the Jotform Submission Inbox
-- (source = 'jotform', already sitting in Firebase Storage from the
-- existing Jotform webhook mirror — jotform_notification_id records which
-- notification it came from so it can be marked processed) or manually
-- uploaded by HR for legacy applicants (source = 'manual').
--
-- Run once in the Supabase SQL Editor, after 0047.
-- =====================================================================

create table if not exists onboarding_documents (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references companies(id) on delete cascade,
  profile_id                uuid not null references profiles(id) on delete cascade,
  category                  text not null,
  file_name                 text not null,
  file_url                  text not null,
  storage_path              text,
  source                    text not null default 'manual' check (source in ('jotform', 'manual')),
  jotform_notification_id   text,
  uploaded_by               uuid references profiles(id),
  created_at                timestamptz not null default now()
);
create index if not exists idx_onboarding_documents_profile on onboarding_documents(company_id, profile_id, category);

create or replace function onboarding_documents_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.uploaded_by is null then
    new.uploaded_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_onboarding_documents_stamp on onboarding_documents;
create trigger trg_onboarding_documents_stamp before insert on onboarding_documents
  for each row execute function onboarding_documents_stamp();

-- ---------- RLS: standard tenant pattern ----------
alter table onboarding_documents enable row level security;
alter table onboarding_documents force row level security;

drop policy if exists onboarding_documents_select on onboarding_documents;
create policy onboarding_documents_select on onboarding_documents
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists onboarding_documents_insert on onboarding_documents;
create policy onboarding_documents_insert on onboarding_documents
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists onboarding_documents_update on onboarding_documents;
create policy onboarding_documents_update on onboarding_documents
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists onboarding_documents_delete on onboarding_documents;
create policy onboarding_documents_delete on onboarding_documents
  for delete using (company_id = auth_company_id() or is_superadmin());
