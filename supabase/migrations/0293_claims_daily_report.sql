-- =====================================================================
-- 0293 — Claims Daily Report (Claims module): replaces the team's manual
-- daily spreadsheet (brand Open/Claim/Pend counts, a "Remaining" reason
-- breakdown, a staff roster, and a Pre-Authorization/Back Orders/
-- Data-Closed tracker) with a real page, following the same manual
-- daily-entry pattern already proven out by ebay_orders/ebay_listings
-- (0280) for the Parts module's "Parts Daily Report eBAY".
--
-- Seven tables:
--   claims_brands                — company-managed brand list (like
--                                   ebay_accounts, 0282), seeded with the
--                                   20 brands from the source spreadsheet.
--   claims_remaining_reasons     — company-managed "why still pending"
--                                   reason list, seeded with the 5 reasons
--                                   from the sheet.
--   claims_daily_reports         — one row per (company, day): the
--                                   snapshot-time label, overview note,
--                                   training count, and general note.
--   claims_daily_brand_counts    — one row per (company, day, brand):
--                                   Open/Claim/Pend counts.
--   claims_daily_remaining_counts — one row per (company, day, reason): count.
--   claims_daily_staff_entries   — one row per (company, day, profile):
--                                   Claimed/Covered/Remarks/Warnings. Start
--                                   Date, Hourly Rate, Position, Hours (of
--                                   work), and Sick/Vacation Leave are
--                                   deliberately NOT stored here — the app
--                                   reads all of those live from
--                                   profiles.employee_info, profiles.
--                                   working_hours, salary_entries, and the
--                                   same pto_requests-based remaining-
--                                   balance calculation Master List uses,
--                                   so none of it can drift from the real
--                                   record. The Warning/Low Performance/
--                                   Good/Great performance flag is ALSO not
--                                   stored — it's a live threshold read off
--                                   claimed_count (see ClaimsDailyReport.tsx's
--                                   computeFlagFromClaimed), so a later
--                                   change to the threshold rule applies to
--                                   every past report instead of only new ones.
--   claims_daily_task_entries    — Pre-Authorization/Back Orders/
--                                   Data-Closed rows, one per assignee per
--                                   task per day (assignee is free text,
--                                   like ebay_branch_settings.assigned_to —
--                                   these names don't reliably map to real
--                                   staff accounts).
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as ebay_orders/ebay_listings (0280).
-- Run once in the Supabase SQL Editor, after 0292.
-- =====================================================================

create table if not exists claims_brands (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists claims_remaining_reasons (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists claims_daily_reports (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  report_date     date not null,
  snapshot_label  text,
  overview_note   text,
  training_count  integer not null default 0,
  general_note    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, report_date)
);

create table if not exists claims_daily_brand_counts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  report_date  date not null,
  brand        text not null,
  open_count   integer not null default 0,
  claim_count  integer not null default 0,
  pend_count   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, report_date, brand)
);
create index if not exists idx_claims_daily_brand_counts_date on claims_daily_brand_counts(company_id, report_date);

create table if not exists claims_daily_remaining_counts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  report_date  date not null,
  reason       text not null,
  count        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, report_date, reason)
);
create index if not exists idx_claims_daily_remaining_counts_date on claims_daily_remaining_counts(company_id, report_date);

create table if not exists claims_daily_staff_entries (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  report_date       date not null,
  profile_id        uuid not null references profiles(id) on delete cascade,
  claimed_count     integer not null default 0,
  covered_brands    text,
  remarks           text,
  warnings          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, report_date, profile_id)
);
create index if not exists idx_claims_daily_staff_entries_date on claims_daily_staff_entries(company_id, report_date);

create table if not exists claims_daily_task_entries (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  report_date    date not null,
  task           text not null check (task in ('Pre-Authorization','Back Orders','Data-Closed')),
  assignee_name  text not null,
  pending_count  integer not null default 0,
  handled_count  integer not null default 0,
  moved_count    integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_claims_daily_task_entries_date on claims_daily_task_entries(company_id, report_date);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function claims_daily_report_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_claims_brands_stamp on claims_brands;
create trigger trg_claims_brands_stamp before insert or update on claims_brands
  for each row execute function claims_daily_report_stamp();
drop trigger if exists trg_claims_remaining_reasons_stamp on claims_remaining_reasons;
create trigger trg_claims_remaining_reasons_stamp before insert or update on claims_remaining_reasons
  for each row execute function claims_daily_report_stamp();
drop trigger if exists trg_claims_daily_reports_stamp on claims_daily_reports;
create trigger trg_claims_daily_reports_stamp before insert or update on claims_daily_reports
  for each row execute function claims_daily_report_stamp();
drop trigger if exists trg_claims_daily_brand_counts_stamp on claims_daily_brand_counts;
create trigger trg_claims_daily_brand_counts_stamp before insert or update on claims_daily_brand_counts
  for each row execute function claims_daily_report_stamp();
drop trigger if exists trg_claims_daily_remaining_counts_stamp on claims_daily_remaining_counts;
create trigger trg_claims_daily_remaining_counts_stamp before insert or update on claims_daily_remaining_counts
  for each row execute function claims_daily_report_stamp();
drop trigger if exists trg_claims_daily_staff_entries_stamp on claims_daily_staff_entries;
create trigger trg_claims_daily_staff_entries_stamp before insert or update on claims_daily_staff_entries
  for each row execute function claims_daily_report_stamp();
drop trigger if exists trg_claims_daily_task_entries_stamp on claims_daily_task_entries;
create trigger trg_claims_daily_task_entries_stamp before insert or update on claims_daily_task_entries
  for each row execute function claims_daily_report_stamp();

-- ---------- RLS: company-scoped, same pattern as ebay_orders (0280) ----------
do $$
declare
  t text;
  tables text[] := array[
    'claims_brands', 'claims_remaining_reasons', 'claims_daily_reports',
    'claims_daily_brand_counts', 'claims_daily_remaining_counts',
    'claims_daily_staff_entries', 'claims_daily_task_entries'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);

    execute format('drop policy if exists %1$s_select on %1$I;', t);
    execute format($f$
      create policy %1$s_select on %1$I
      for select using (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_insert on %1$I;', t);
    execute format($f$
      create policy %1$s_insert on %1$I
      for insert with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_update on %1$I;', t);
    execute format($f$
      create policy %1$s_update on %1$I
      for update using (company_id = auth_company_id() or is_superadmin())
                  with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_delete on %1$I;', t);
    execute format($f$
      create policy %1$s_delete on %1$I
      for delete using (company_id = auth_company_id() or is_superadmin());
    $f$, t);
  end loop;
end $$;

-- Seed the 20 brands and 5 "Remaining" reasons from the source
-- spreadsheet for every existing company — safe to rename/retire
-- afterward from the report's own "Edit brands"/"Edit reasons" controls.
insert into claims_brands (company_id, name, sort_order)
select c.id, b.name, b.ord
from companies c
cross join (
  select * from unnest(array[
    'GE','SQT','ASSURANT','ELECTROLUX','HISENSE','AIG','ASURION','MIELE',
    'CENTRICITY','SPQ','FIDELITY','INTERNAL','MIDEA','SPPN','Onpoint',
    'NSA','OOW','BUILDER','SS','LG'
  ]) with ordinality as t(name, ord)
) b
on conflict (company_id, name) do nothing;

insert into claims_remaining_reasons (company_id, name, sort_order)
select c.id, r.name, r.ord
from companies c
cross join (
  select * from unnest(array[
    'Preauth','Tech Update','Follow up needed','Parts issue','Moved after shift/not handled'
  ]) with ordinality as t(name, ord)
) r
on conflict (company_id, name) do nothing;
