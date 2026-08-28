-- =====================================================================
-- 0126 — General Information: branch management directory
--
-- Backs the new "General Information" page (Dashboard module): per-branch
-- role assignments, regional groupings, and top-level leadership titles.
-- Replaces an external spreadsheet the branches maintained by hand.
--
-- Three tables, same company-scoped RLS/trigger pattern as
-- tech_repair_rates (0120) / mileage_entries (0125). "Technical Manager"
-- and "Regional Technical Manager" are two distinct roles (the source
-- spreadsheet listed "Technical Manager" twice with different people filled
-- in per branch) — kept as separate columns rather than merged.
--
-- Seed data is transcribed directly from the spreadsheet, mapped to the
-- app's existing LOCATIONS branch names (src/lib/locations.ts) instead of
-- the sheet's abbreviated codes. Run in the Supabase SQL Editor directly
-- (not through the app), so auth_company_id() has no JWT context to read —
-- each seed row instead resolves company_id by looking up 'AH Solutions'
-- (legacy_code 'COMP001', the only real operating company in this
-- database — this project's `companies` table also has a few unrelated
-- demo/test tenants, so a bare `limit 1` is NOT safe here). Safe to
-- re-run: every insert has an `on conflict do nothing`.
--
-- Run once in the Supabase SQL Editor, after 0125.
-- =====================================================================

-- ---------- Schema ----------

create table if not exists general_info_branch_roles (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references companies(id) on delete cascade,
  branch                      text not null,
  senior_branch_manager       text,
  branch_manager               text,
  technical_manager           text,
  bizops                       text,
  regional_technical_manager  text,
  parts_manager                text,
  assistant_parts_manager     text,
  sort_order                  int not null default 0,
  updated_at                  timestamptz not null default now(),
  unique (company_id, branch)
);
create index if not exists idx_general_info_branch_roles_company on general_info_branch_roles(company_id);

create table if not exists general_info_regions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  region_name  text not null,
  region_lead  text,
  branches     text[] not null default '{}',
  sort_order   int not null default 0,
  unique (company_id, region_name)
);
create index if not exists idx_general_info_regions_company on general_info_regions(company_id);

create table if not exists general_info_leadership (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  title       text not null,
  name        text,
  sort_order  int not null default 0,
  unique (company_id, title)
);
create index if not exists idx_general_info_leadership_company on general_info_leadership(company_id);

-- ---------- Trigger + RLS (identical shape for all three tables) ----------

create or replace function general_info_stamp_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_general_info_branch_roles_stamp on general_info_branch_roles;
create trigger trg_general_info_branch_roles_stamp before insert on general_info_branch_roles
  for each row execute function general_info_stamp_company();

drop trigger if exists trg_general_info_regions_stamp on general_info_regions;
create trigger trg_general_info_regions_stamp before insert on general_info_regions
  for each row execute function general_info_stamp_company();

drop trigger if exists trg_general_info_leadership_stamp on general_info_leadership;
create trigger trg_general_info_leadership_stamp before insert on general_info_leadership
  for each row execute function general_info_stamp_company();

alter table general_info_branch_roles enable row level security;
alter table general_info_branch_roles force row level security;
alter table general_info_regions enable row level security;
alter table general_info_regions force row level security;
alter table general_info_leadership enable row level security;
alter table general_info_leadership force row level security;

do $$
declare
  t text;
begin
  foreach t in array array['general_info_branch_roles', 'general_info_regions', 'general_info_leadership'] loop
    execute format('drop policy if exists %1$s_select on %1$I', t);
    execute format('create policy %1$s_select on %1$I for select using (company_id = auth_company_id() or is_superadmin())', t);

    execute format('drop policy if exists %1$s_insert on %1$I', t);
    execute format('create policy %1$s_insert on %1$I for insert with check (company_id = auth_company_id() or is_superadmin())', t);

    execute format('drop policy if exists %1$s_update on %1$I', t);
    execute format('create policy %1$s_update on %1$I for update using (company_id = auth_company_id() or is_superadmin()) with check (company_id = auth_company_id() or is_superadmin())', t);

    execute format('drop policy if exists %1$s_delete on %1$I', t);
    execute format('create policy %1$s_delete on %1$I for delete using (company_id = auth_company_id() or is_superadmin())', t);
  end loop;
end $$;

-- ---------- Seed data ----------

insert into general_info_branch_roles
  (company_id, branch, senior_branch_manager, branch_manager, technical_manager, bizops, regional_technical_manager, parts_manager, assistant_parts_manager, sort_order)
values
  ((select id from companies where legacy_code = 'COMP001'), 'Asheville',       'Matt Simmons',    'Daven Hodge',            null,               'Maverick', null,                     'Johnathan Allen_AV',        'Reggie Stewart', 1),
  ((select id from companies where legacy_code = 'COMP001'), 'Atlanta',         'Matt Simmons',    'Daven Hodge',            'Kevin Khaiphanliane', 'Maverick', null,                  'Calvin Nguyen',              'Reggie Stewart', 2),
  ((select id from companies where legacy_code = 'COMP001'), 'Birmingham',      'Danny Thornton',  'David Sims',             null,               'Wincel',   null,                     'Reach out to Kenny Shin',   'Reggie Stewart', 3),
  ((select id from companies where legacy_code = 'COMP001'), 'Cape Girardeau',  'Lashamus Dowell', 'Matthew Nichols',        null,               'Lloyd',    null,                     'Alaska Olinger',             'Reggie Stewart', 4),
  ((select id from companies where legacy_code = 'COMP001'), 'Chattanooga',     'Lashamus Dowell', 'Daven Hodge',            null,               'Lloyd',    null,                     'Jacob Blackburn',            'Reggie Stewart', 5),
  ((select id from companies where legacy_code = 'COMP001'), 'Columbus',        'Matt Simmons',    'Matt Simmons',           null,               'Maverick', null,                     'Amanda Simmons',             'Reggie Stewart', 6),
  ((select id from companies where legacy_code = 'COMP001'), 'Destin',          'Danny Thornton',  'Daven Hodge',            null,               'Wincel',   'Garrett McCarley',       'Garrett McCarley',           'Reggie Stewart', 7),
  ((select id from companies where legacy_code = 'COMP001'), 'Huntsville',      'Lashamus Dowell', 'Jordan Stanley',         null,               'Lloyd',    null,                     'Nathan Wagner',              'Reggie Stewart', 8),
  ((select id from companies where legacy_code = 'COMP001'), 'Jackson, MS',     'Danny Thornton',  'Danny Thornton',         null,               'Wincel',   'Lashamus Dowell',        'Reggie Stewart',             null, 9),
  ((select id from companies where legacy_code = 'COMP001'), 'Jackson, TN',     'Lashamus Dowell', 'Lashamus Dowell',        null,               'Lloyd',    null,                     'Cameron Forest',             'Reggie Stewart', 10),
  ((select id from companies where legacy_code = 'COMP001'), 'Jacksonville',    'Matt Simmons',    'Daven Hodge',            null,               'Lloyd',    null,                     'Farahnaz Qasemi',            'Reggie Stewart', 11),
  ((select id from companies where legacy_code = 'COMP001'), 'Jonesboro',       'Lashamus Dowell', 'Lashamus Dowell',        null,               'Lloyd',    null,                     'Farris Bruce',               null, 12),
  ((select id from companies where legacy_code = 'COMP001'), 'Knoxville',       'Lashamus Dowell', 'N/A',                    null,               'Maverick', null,                     'James Houston',              'Reggie Stewart', 13),
  ((select id from companies where legacy_code = 'COMP001'), 'Lake Charles',    'Danny Thornton',  'Danny Thornton',         'Cooper Shaffett',  'Wincel',   null,                     'Danny Thorton',              'Reggie Stewart', 14),
  ((select id from companies where legacy_code = 'COMP001'), 'Little Rock',     'Danny Thornton',  'Danny Thornton',         null,               'Wincel',   null,                     'Blake Shinn',                'Reggie Stewart', 15),
  ((select id from companies where legacy_code = 'COMP001'), 'Memphis',         'Lashamus Dowell', 'Sean Smith',             null,               'Lloyd',    null,                     'Annan Odongo',               'Farris', 16),
  ((select id from companies where legacy_code = 'COMP001'), 'Mobile',          'Danny Thornton',  'Daven Hodge',            null,               'Wincel',   null,                     'Lauren Andrew',              'Farris', 17),
  ((select id from companies where legacy_code = 'COMP001'), 'Montgomery',      'Matt Simmons',    'Andy Oh',                null,               'Maverick', null,                     null,                         'Farris', 18),
  ((select id from companies where legacy_code = 'COMP001'), 'Nashville',       'Lashamus Dowell', 'N/A',                    'John Geodfrey',    'Lloyd',    null,                     'Juliana Ferguson',           'Farris', 19),
  ((select id from companies where legacy_code = 'COMP001'), 'New Orleans',     'Danny Thornton',  'Danny Thornton',         null,               'Wincel',   null,                     'Shannon Thomas',             'Farris', 20),
  ((select id from companies where legacy_code = 'COMP001'), 'Norfolk',         'Matt Simmons',    'Chris Simpson',          null,               'Maverick', null,                     'Brandi Smith',               'Farris', 21),
  ((select id from companies where legacy_code = 'COMP001'), 'Raleigh',         'Matt Simmons',    'Daven Hodge',            null,               'Maverick', 'Alexxis Henry',          'Mason Redker',               'Farris', 22),
  ((select id from companies where legacy_code = 'COMP001'), 'Richmond',        'Matt Simmons',    'Alexis Henry',           null,               'Maverick', null,                     'Kolby Fleck',                'Farris', 23),
  ((select id from companies where legacy_code = 'COMP001'), 'San Antonio',     'Danny Thornton',  'Erick Guzman Juarez',    null,               'Wincel',   null,                     'Erick Guzman',               'Farris', 24),
  ((select id from companies where legacy_code = 'COMP001'), 'Savannah',        'Matt Simmons',    'Lance Novak',            null,               'Maverick', null,                     'Christopher Kennelley',      'Farris', 25),
  ((select id from companies where legacy_code = 'COMP001'), 'St. Louis',       'Lashamus Dowell', 'Derious Nichols',        null,               'Lloyd',    null,                     'Crystal Dziedzic',           'Farris', 26),
  ((select id from companies where legacy_code = 'COMP001'), 'Tallahassee',     'Danny Thornton',  'Matthew Mccrary',        null,               'Wincel',   null,                     'Krista Griffiss',            'Farris', 27),
  ((select id from companies where legacy_code = 'COMP001'), 'Wilmington',      'Matt Simmons',    'Brye''shawn Butler',     null,               'Maverick', null,                     'David Lopez',                'Farris', 28)
on conflict (company_id, branch) do nothing;

insert into general_info_regions (company_id, region_name, region_lead, branches, sort_order)
values
  ((select id from companies where legacy_code = 'COMP001'), 'Western Region', 'Danny Thornton',
    array['Birmingham','Destin','Jackson, MS','Lake Charles','Little Rock','Mobile','New Orleans','San Antonio','Tallahassee'], 1),
  ((select id from companies where legacy_code = 'COMP001'), 'Central Region', 'Lashamus Dowell',
    array['Cape Girardeau','Chattanooga','Huntsville','Jonesboro','Jackson, TN','Knoxville','Memphis','Nashville','St. Louis'], 2),
  ((select id from companies where legacy_code = 'COMP001'), 'Eastern Region', 'Matt Simmons',
    array['Asheville','Atlanta','Columbus','Jacksonville','Montgomery','Norfolk','Richmond','Raleigh','Savannah','Wilmington'], 3)
on conflict (company_id, region_name) do nothing;

insert into general_info_leadership (company_id, title, name, sort_order)
values
  ((select id from companies where legacy_code = 'COMP001'), 'Technical Director', 'Daven Hodge', 1),
  ((select id from companies where legacy_code = 'COMP001'), 'Technical Assistant Director', 'Alexxis Henry', 2)
on conflict (company_id, title) do nothing;
