-- =====================================================================
-- 0127 — General Information: abbreviations glossary
--
-- Adds the "Abbreviations" tab to the General Information page — a simple
-- editable (abbreviation -> meaning) glossary, split into two categories
-- ("General" terms like XW/IW/OW, and "Branch/Area" codes like ATL/AV/BM)
-- via the `category` column. Same company-scoped RLS/trigger pattern as
-- the other general_info_* tables (0126).
--
-- Seed data transcribed as-given from the source glossary, including its
-- own inconsistent capitalization/spelling (e.g. "HUNSTVILLE",
-- "CAPE GERARDUE") — this is reference text the company already uses, not
-- normalized against LOCATIONS.
--
-- Same company_id caveat as 0126: this Supabase project has more than one
-- row in `companies` (a few unrelated demo/test tenants alongside the real
-- one), so seed rows resolve company_id via legacy_code = 'COMP001'
-- ('AH Solutions'), not a bare `limit 1`.
--
-- Run once in the Supabase SQL Editor, after 0126.
-- =====================================================================

create table if not exists general_info_abbreviations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  category     text not null default 'General',
  abbreviation text not null,
  meaning      text,
  sort_order   int not null default 0,
  unique (company_id, category, abbreviation)
);
create index if not exists idx_general_info_abbreviations_company on general_info_abbreviations(company_id);

create or replace function general_info_abbreviations_stamp_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_general_info_abbreviations_stamp on general_info_abbreviations;
create trigger trg_general_info_abbreviations_stamp before insert on general_info_abbreviations
  for each row execute function general_info_abbreviations_stamp_company();

alter table general_info_abbreviations enable row level security;
alter table general_info_abbreviations force row level security;

drop policy if exists general_info_abbreviations_select on general_info_abbreviations;
create policy general_info_abbreviations_select on general_info_abbreviations
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists general_info_abbreviations_insert on general_info_abbreviations;
create policy general_info_abbreviations_insert on general_info_abbreviations
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists general_info_abbreviations_update on general_info_abbreviations;
create policy general_info_abbreviations_update on general_info_abbreviations
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists general_info_abbreviations_delete on general_info_abbreviations;
create policy general_info_abbreviations_delete on general_info_abbreviations
  for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- Seed data ----------

insert into general_info_abbreviations (company_id, category, abbreviation, meaning, sort_order)
values
  ((select id from companies where legacy_code = 'COMP001'), 'General', 'XW',   'Extended warranty', 1),
  ((select id from companies where legacy_code = 'COMP001'), 'General', 'IW',   'In warranty', 2),
  ((select id from companies where legacy_code = 'COMP001'), 'General', 'OW',   'Out of warranty', 3),
  ((select id from companies where legacy_code = 'COMP001'), 'General', 'PO',   'Part order', 4),
  ((select id from companies where legacy_code = 'COMP001'), 'General', 'Cx',   'Customer', 5),
  ((select id from companies where legacy_code = 'COMP001'), 'General', 'Dx',   'Diagnosis', 6),
  ((select id from companies where legacy_code = 'COMP001'), 'General', 'Tx',   'Technician', 7),
  ((select id from companies where legacy_code = 'COMP001'), 'General', 'CLPW', 'Covered Labor/Parts Warranty', 8),

  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'ATL',   'Atlanta', 1),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'AV',    'Asheville', 2),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'BM',    'Birmingham', 3),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'CT',    'Chattanooga', 4),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'CB',    'Columbus', 5),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'CG',    'Cape Girardeau', 6),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'DT',    'Destin', 7),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'HV',    'Huntsville', 8),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'JS MS', 'Jackson, MS', 9),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'JS TN', 'Jackson, TN', 10),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'JV',    'Jacksonville', 11),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'JB',    'Jonesboro', 12),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'KV',    'Knoxville', 13),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'LR',    'Little Rock', 14),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'MP',    'Memphis', 15),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'MB',    'Mobile', 16),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'MT',    'Montgomery', 17),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'NV',    'Nashville', 18),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'NO',    'New Orleans', 19),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'NF',    'Norfolk', 20),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'RL',    'Raleigh', 21),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'RC',    'Richmond', 22),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'SV',    'Savannah', 23),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'ST',    'St. Louis', 24),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'TL',    'Tallahassee', 25),
  ((select id from companies where legacy_code = 'COMP001'), 'Branch/Area', 'WM',    'Wilmington', 26)
on conflict (company_id, category, abbreviation) do nothing;
