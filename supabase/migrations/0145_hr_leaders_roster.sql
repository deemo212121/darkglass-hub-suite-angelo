-- =====================================================================
-- 0145 — HR "Leaders" tab: department-grouped leadership roster
--
-- Backs the new "Leaders" tab on the HR Daily Report page (ReportHRDaily.tsx)
-- — a curated org roster (department block -> role title -> person), edited
-- by dragging rows to reorder or move between departments. Deliberately a
-- separate hand-maintained table, NOT derived from profiles.role/department
-- like the "Master List" tab is: several of these titles ("Assistant
-- Manager", "Senior Director", "Tech Manager ATL", "Parts Order" as its own
-- department distinct from "Parts Manager") don't correspond to any real
-- role code in this app's role enum, so there's no reliable way to derive
-- them from profiles.
--
-- Same company-scoped RLS/trigger pattern as general_info_leadership
-- (0126) / mileage_entries (0125). row_sort is numeric (not int) so a drag
-- can insert between two existing rows by picking the midpoint value,
-- instead of renumbering the whole department block on every reorder.
--
-- Seed data transcribed directly from the spreadsheet the user provided.
-- Run in the Supabase SQL Editor directly (not through the app), so
-- auth_company_id() has no JWT context — resolves company_id via
-- legacy_code 'COMP001' instead, same as 0126. Safe to re-run: the whole
-- seed block is gated behind "insert only if this table is still empty".
--
-- Run once in the Supabase SQL Editor, after 0144.
-- =====================================================================

-- ---------- Schema ----------

create table if not exists hr_leaders_roster (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  department    text not null,
  role_title    text not null,
  person_name   text not null,
  tier          text not null default 'standard' check (tier in ('senior', 'manager', 'standard')),
  dept_sort     int not null default 0,
  row_sort      numeric not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_hr_leaders_roster_company on hr_leaders_roster(company_id);

create or replace function hr_leaders_roster_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_leaders_roster_stamp on hr_leaders_roster;
create trigger trg_hr_leaders_roster_stamp before insert on hr_leaders_roster
  for each row execute function hr_leaders_roster_stamp();

create or replace function hr_leaders_roster_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_hr_leaders_roster_touch on hr_leaders_roster;
create trigger trg_hr_leaders_roster_touch before update on hr_leaders_roster
  for each row execute function hr_leaders_roster_touch();

alter table hr_leaders_roster enable row level security;
alter table hr_leaders_roster force row level security;

drop policy if exists hr_leaders_roster_select on hr_leaders_roster;
create policy hr_leaders_roster_select on hr_leaders_roster for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_leaders_roster_insert on hr_leaders_roster;
create policy hr_leaders_roster_insert on hr_leaders_roster for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_leaders_roster_update on hr_leaders_roster;
create policy hr_leaders_roster_update on hr_leaders_roster for update using (company_id = auth_company_id() or is_superadmin()) with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_leaders_roster_delete on hr_leaders_roster;
create policy hr_leaders_roster_delete on hr_leaders_roster for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- Seed data ----------

do $$
declare
  cid uuid;
begin
  if exists (select 1 from hr_leaders_roster limit 1) then
    return; -- already seeded (or an admin has since edited it) — never overwrite
  end if;

  select id into cid from companies where legacy_code = 'COMP001';
  if cid is null then
    return; -- unknown environment — skip seeding rather than guess a company
  end if;

  insert into hr_leaders_roster (company_id, department, role_title, person_name, tier, dept_sort, row_sort) values
  -- CSR
  (cid, 'CSR', 'Senior Manager', 'Lou Basco', 'senior', 1, 1),
  (cid, 'CSR', 'Manager', 'Robyn Heredia', 'manager', 1, 2),
  (cid, 'CSR', 'Manager', 'Raul Bayuyos', 'manager', 1, 3),
  (cid, 'CSR', 'Team Leader', 'Daniela Mercado', 'standard', 1, 4),
  (cid, 'CSR', 'Team Leader', 'Patrick Tendero', 'standard', 1, 5),
  (cid, 'CSR', 'Team Leader', 'Rochelle Ann Ortiz', 'standard', 1, 6),
  (cid, 'CSR', 'Team Leader', 'Kyle Jomarc Sicat', 'standard', 1, 7),
  (cid, 'CSR', 'Team Leader', 'Ma. Czarina Lagumen', 'standard', 1, 8),
  (cid, 'CSR', 'Team Leader', 'Shane Marie Rebadomoa', 'standard', 1, 9),
  -- Parts Manager
  (cid, 'Parts Manager', 'Senior Manager', 'Naveen Lakhani', 'senior', 2, 1),
  (cid, 'Parts Manager', 'Assistant Manager', 'Reginald Stewart', 'manager', 2, 2),
  (cid, 'Parts Manager', 'Assistant Manager', 'Farris Bruce', 'manager', 2, 3),
  (cid, 'Parts Manager', 'Team Leader', 'Krista Griffiss', 'standard', 2, 4),
  (cid, 'Parts Manager', 'Team Leader', 'Annan Odongo', 'standard', 2, 5),
  (cid, 'Parts Manager', 'Team Leader', 'Calvin Nguyen', 'standard', 2, 6),
  (cid, 'Parts Manager', 'Team Leader', 'Shannon Thomas', 'standard', 2, 7),
  (cid, 'Parts Manager', 'Team Leader', 'Jacob Blackburn', 'standard', 2, 8),
  -- Claims
  (cid, 'Claims', 'Senior Director', 'Tina Yong', 'senior', 3, 1),
  (cid, 'Claims', 'Team Leader', 'Arnulfo Jr Pongos Montesclaros', 'standard', 3, 2),
  (cid, 'Claims', 'Team Leader', 'Marie Frances Javier', 'standard', 3, 3),
  -- BizOps
  (cid, 'BizOps', 'Senior Manager', 'Jerich Bolico', 'senior', 4, 1),
  (cid, 'BizOps', 'Manager', 'Maverick Neito', 'manager', 4, 2),
  (cid, 'BizOps', 'Manager', 'LLoyd Tombiga', 'manager', 4, 3),
  (cid, 'BizOps', 'Manager', 'Wincel Carusca', 'manager', 4, 4),
  -- Parts Order
  (cid, 'Parts Order', 'Senior Manager', 'Naveen Lakhani', 'senior', 5, 1),
  (cid, 'Parts Order', 'Manager', 'Alyssa Diones', 'manager', 5, 2),
  (cid, 'Parts Order', 'Manager', 'Cheska Timkang', 'manager', 5, 3),
  -- Accounting
  (cid, 'Accounting', 'Senior Manager', 'Lou Basco', 'senior', 6, 1),
  (cid, 'Accounting', 'Team Leader', 'Mary Grace Cosio', 'standard', 6, 2),
  -- Technical Support
  (cid, 'Technical Support', 'Technical Director', 'Daven Hodge', 'senior', 7, 1),
  (cid, 'Technical Support', 'Manager', 'Mark Marquez', 'manager', 7, 2),
  -- Human Resources
  (cid, 'Human Resources', 'Senior Manager', 'Lou Basco', 'senior', 8, 1),
  (cid, 'Human Resources', 'Manager', 'Frederick Cabilao', 'manager', 8, 2),
  -- Information Technology
  (cid, 'Information Technology', 'Senior Manager', 'Jerich Bolico', 'senior', 9, 1),
  -- Technician
  (cid, 'Technician', 'Technical Director', 'Daven Hodge', 'senior', 10, 1),
  (cid, 'Technician', 'Assistant Technical Director', 'Alexxis Henry', 'manager', 10, 2),
  (cid, 'Technician', 'Senior Branch Manager', 'Matt Simmons', 'senior', 10, 3),
  (cid, 'Technician', 'Senior Branch Manager', 'Lashamus Dowell', 'senior', 10, 4),
  (cid, 'Technician', 'Senior Branch Manager', 'Danny Thornton', 'senior', 10, 5),
  (cid, 'Technician', 'Tech Manager ATL', 'Keven Khaiphanliane', 'standard', 10, 6),
  (cid, 'Technician', 'Branch Manager CG', 'Matthew Nichols', 'standard', 10, 7),
  (cid, 'Technician', 'Branch Manager', 'Matthew McCarry', 'standard', 10, 8),
  (cid, 'Technician', 'Branch Manager WM', 'Bryeshawn Butler', 'standard', 10, 9),
  (cid, 'Technician', 'Branch Manager STL', 'Derious Nichols', 'standard', 10, 10),
  (cid, 'Technician', 'Tech Manager LC', 'Cooper Shaffett', 'standard', 10, 11),
  (cid, 'Technician', 'Branch Manager SV', 'Lance Novak', 'standard', 10, 12),
  (cid, 'Technician', 'Tech Manager NV', 'John Godfrey', 'standard', 10, 13),
  (cid, 'Technician', 'Branch Manager DT', 'Garrett McCarley', 'standard', 10, 14),
  (cid, 'Technician', 'Branch Manager SA', 'Erick Guzman', 'standard', 10, 15),
  (cid, 'Technician', 'Branch Manager MP', 'Sean Smith', 'standard', 10, 16),
  (cid, 'Technician', 'Branch Manager BM', 'David Sims', 'standard', 10, 17),
  (cid, 'Technician', 'Branch Manager NF, RM', 'Chris Simpson', 'standard', 10, 18),
  (cid, 'Technician', 'Branch Manager HV', 'Jordan Stanley', 'standard', 10, 19),
  (cid, 'Technician', 'Branch Manager MG', 'Andy Oh', 'standard', 10, 20);
end $$;
