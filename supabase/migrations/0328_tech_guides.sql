-- =====================================================================
-- 0328 — Tech Tips / Repair Guides.
--
-- 1. tech_guides — a company's edited copy of a built-in guide
--    (src/lib/techGuides.ts DEFAULT_TECH_GUIDES, from the "Tech Protocols"
--    document). A row replaces the built-in guide with the same guide_key;
--    no row = the built-in default. Editable by Technical Director,
--    Technical Assistant Director, Senior Branch Manager and Admin-and-up
--    (role or extra_roles), per the user's explicit call.
--
-- 2. ticket_guide_readings — what a tech recorded against a guide on one
--    visit: the guide's test-checklist readings (ohms, voltages,
--    Good/Poor/Bad...) and which check steps were ticked, as one jsonb
--    blob. Any company member can record (techs fill these in on the job).
--
-- Additive only — two new tables, no existing rows touched.
-- Run once in the Supabase SQL Editor, after 0327.
-- =====================================================================

create table if not exists tech_guides (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  guide_key           text not null,
  title               text not null,
  product_categories  text[] not null default '{}',
  intro               text not null default '',
  sections            jsonb not null default '[]'::jsonb,
  readings            jsonb not null default '[]'::jsonb,
  updated_by          uuid references profiles(id),
  updated_by_name     text,
  updated_at          timestamptz not null default now(),
  unique (company_id, guide_key)
);

create table if not exists ticket_guide_readings (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  ticket_id        uuid not null references tickets(id) on delete cascade,
  visit_id         uuid not null references visits(id) on delete cascade,
  guide_key        text not null,
  "values"         jsonb not null default '{}'::jsonb,
  updated_by       uuid references profiles(id),
  updated_by_name  text,
  updated_at       timestamptz not null default now(),
  unique (visit_id, guide_key)
);
create index if not exists idx_ticket_guide_readings_ticket on ticket_guide_readings(ticket_id);

-- Stamp company + editor on write, same pattern as other company tables.
create or replace function tech_guides_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_by := auth_profile_id();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tech_guides_stamp on tech_guides;
create trigger trg_tech_guides_stamp before insert or update on tech_guides
  for each row execute function tech_guides_stamp();

drop trigger if exists trg_ticket_guide_readings_stamp on ticket_guide_readings;
create trigger trg_ticket_guide_readings_stamp before insert or update on ticket_guide_readings
  for each row execute function tech_guides_stamp();

create or replace function can_edit_tech_guides()
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if is_admin() or is_company_superadmin() or is_superadmin() then
    return true;
  end if;
  return exists (
    select 1 from profiles
    where id = auth_profile_id()
      and (
        role in ('ADMIN', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR', 'SENIOR_BRANCH_MANAGER')
        or coalesce(extra_roles, '{}') && array['ADMIN', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR', 'SENIOR_BRANCH_MANAGER']
      )
  );
end;
$$;

alter table tech_guides enable row level security;
alter table tech_guides force row level security;

drop policy if exists tech_guides_select on tech_guides;
create policy tech_guides_select on tech_guides
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists tech_guides_insert on tech_guides;
create policy tech_guides_insert on tech_guides
  for insert with check ((company_id = auth_company_id() or is_superadmin()) and can_edit_tech_guides());
drop policy if exists tech_guides_update on tech_guides;
create policy tech_guides_update on tech_guides
  for update using ((company_id = auth_company_id() or is_superadmin()) and can_edit_tech_guides())
  with check ((company_id = auth_company_id() or is_superadmin()) and can_edit_tech_guides());
drop policy if exists tech_guides_delete on tech_guides;
create policy tech_guides_delete on tech_guides
  for delete using ((company_id = auth_company_id() or is_superadmin()) and can_edit_tech_guides());

alter table ticket_guide_readings enable row level security;
alter table ticket_guide_readings force row level security;

drop policy if exists ticket_guide_readings_select on ticket_guide_readings;
create policy ticket_guide_readings_select on ticket_guide_readings
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists ticket_guide_readings_insert on ticket_guide_readings;
create policy ticket_guide_readings_insert on ticket_guide_readings
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ticket_guide_readings_update on ticket_guide_readings;
create policy ticket_guide_readings_update on ticket_guide_readings
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());
