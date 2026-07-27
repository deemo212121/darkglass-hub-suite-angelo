-- =====================================================================
-- 0077 — In-house Form Maker: custom form definitions + submissions
--
-- Lets HR/Admin build their own forms inside AHS (drag-and-drop field
-- editor, see CustomFormBuilder.tsx) instead of depending on Jotform's
-- builder. Runs ALONGSIDE the existing Jotform pipeline
-- (hr_jotform_submissions, 0054/0055) — that pipeline is untouched.
--
-- Two tables, same conventions as hr_jotform_submissions: company_id
-- stamping trigger, auth_company_id()/is_superadmin() RLS, 30-day
-- soft-delete on submissions, added to supabase_realtime.
--
-- hr_custom_forms.access ('public' | 'internal') decides who fills a form
-- out: 'internal' forms are only reachable by logged-in AHS users (direct
-- authenticated read/write below, normal company RLS); 'public' forms are
-- reachable by anyone with the link and no AHS account (job applicants,
-- like Jotform today) — those never write here directly. All public-form
-- traffic (schema reads AND submissions) goes through the api/custom-forms
-- serverless endpoint using the service-role key, the same shape as the
-- existing Jotform webhook — see src/lib/server/customFormsBridge.ts. The
-- one extra `anon` SELECT policy below only ever exposes a published
-- public form's field schema (never submissions, never other rows), so
-- that endpoint doesn't strictly need it, but keeps a lightweight path
-- open for a future client-only public renderer without widening anything
-- else.
--
-- Run once in the Supabase SQL Editor, after 0076.
-- =====================================================================

create table if not exists hr_custom_forms (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  title         text not null,
  description   text,
  access        text not null default 'internal' check (access in ('public', 'internal')),
  status        text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- Generated on first publish (see publishCustomForm in customForms.ts) —
  -- the public-facing URL uses this instead of the raw id so a form can be
  -- unpublished/republished without ever changing its link.
  public_slug   text unique,
  -- Ordered array of { id, type, label, required, options?, placeholder?, helpText? } —
  -- see CustomFormField in src/lib/customFormFields.ts.
  fields        jsonb not null default '[]'::jsonb,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_hr_custom_forms_company on hr_custom_forms(company_id, status);

create table if not exists hr_custom_form_submissions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  form_id         uuid not null references hr_custom_forms(id) on delete cascade,
  -- Snapshot of the form's title at submission time — renaming the form
  -- later shouldn't rewrite history, same reasoning as
  -- hr_jotform_submissions.form_title.
  form_title      text,
  submitter_name  text,
  -- { [field.id]: value }, or { [field.id]: { path, url, fileName, mimeType, size } }
  -- for file/signature fields — see CustomFormField.
  responses       jsonb not null default '{}'::jsonb,
  status          text not null default 'new' check (status in ('new', 'reviewed', 'archived')),
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  deleted_at      timestamptz
);
create index if not exists idx_hr_custom_form_submissions_company on hr_custom_form_submissions(company_id, submitted_at desc);
create index if not exists idx_hr_custom_form_submissions_form on hr_custom_form_submissions(form_id, submitted_at desc);
create index if not exists idx_hr_custom_form_submissions_status on hr_custom_form_submissions(company_id, status);

create or replace function hr_custom_forms_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.created_by is null then
    new.created_by := auth_profile_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_hr_custom_forms_stamp on hr_custom_forms;
create trigger trg_hr_custom_forms_stamp before insert on hr_custom_forms
  for each row execute function hr_custom_forms_stamp();

create or replace function hr_custom_forms_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_hr_custom_forms_touch on hr_custom_forms;
create trigger trg_hr_custom_forms_touch before update on hr_custom_forms
  for each row execute function hr_custom_forms_touch_updated_at();

create or replace function hr_custom_form_submissions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_custom_form_submissions_stamp on hr_custom_form_submissions;
create trigger trg_hr_custom_form_submissions_stamp before insert on hr_custom_form_submissions
  for each row execute function hr_custom_form_submissions_stamp();

-- ---------- RLS: hr_custom_forms ----------
alter table hr_custom_forms enable row level security;
alter table hr_custom_forms force row level security;

drop policy if exists hr_custom_forms_select on hr_custom_forms;
create policy hr_custom_forms_select on hr_custom_forms
  for select using (company_id = auth_company_id() or is_superadmin());

-- Lets an unauthenticated visitor's browser resolve a published public
-- form's schema by its public_slug — never exposes drafts, internal forms,
-- or any other table.
drop policy if exists hr_custom_forms_public_select on hr_custom_forms;
create policy hr_custom_forms_public_select on hr_custom_forms
  for select to anon using (status = 'published' and access = 'public');

drop policy if exists hr_custom_forms_insert on hr_custom_forms;
create policy hr_custom_forms_insert on hr_custom_forms
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_custom_forms_update on hr_custom_forms;
create policy hr_custom_forms_update on hr_custom_forms
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_custom_forms_delete on hr_custom_forms;
create policy hr_custom_forms_delete on hr_custom_forms
  for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- RLS: hr_custom_form_submissions ----------
-- No anon insert policy — every submission (public or internal) is written
-- by api/custom-forms.ts using the service-role key, exactly like the
-- Jotform webhook writes hr_jotform_submissions. Only same-company
-- authenticated staff can read/manage rows here.
alter table hr_custom_form_submissions enable row level security;
alter table hr_custom_form_submissions force row level security;

drop policy if exists hr_custom_form_submissions_select on hr_custom_form_submissions;
create policy hr_custom_form_submissions_select on hr_custom_form_submissions
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_custom_form_submissions_insert on hr_custom_form_submissions;
create policy hr_custom_form_submissions_insert on hr_custom_form_submissions
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_custom_form_submissions_update on hr_custom_form_submissions;
create policy hr_custom_form_submissions_update on hr_custom_form_submissions
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_custom_form_submissions_delete on hr_custom_form_submissions;
create policy hr_custom_form_submissions_delete on hr_custom_form_submissions
  for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- Realtime ----------
do $$
begin
  alter publication supabase_realtime add table hr_custom_forms;
exception when duplicate_object then
  raise notice 'hr_custom_forms already in supabase_realtime publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table hr_custom_form_submissions;
exception when duplicate_object then
  raise notice 'hr_custom_form_submissions already in supabase_realtime publication';
end $$;
