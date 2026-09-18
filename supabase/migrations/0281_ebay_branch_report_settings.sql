-- =====================================================================
-- 0281 — Per-branch settings + daily comments for the "Parts Daily
-- Report eBAY" Summary tab, matching the team's existing daily branch
-- rollup (BRANCH / ASSIGNED / LISTINGS / SALES QTY / SALES / RETURN QTY
-- / RETURNS VALUE / COMMENTS, stacked one block per day with a Totals
-- row) that isn't in the "Ebay Daily Reports.xlsx" workbook itself.
--
-- Sales/Returns qty+value are computed live from ebay_orders (0280) —
-- only the things with no other source are stored here:
--   ebay_branch_settings      — Assigned staff, shared per branch group
--                                (edited on the Assignments tab).
--   ebay_branch_daily_notes   — one row per (branch, day): free-text
--                                Comments (matches the workbook's daily
--                                comment cells) AND the Listings status
--                                (Paused / All Listed) for that ONE day —
--                                edited directly on the Summary tab's
--                                Daily Branch Report, never a shared
--                                "current" value, so a branch Paused on
--                                Monday and un-paused Tuesday is two
--                                different rows here, and a report
--                                re-generated for a past date range shows
--                                what was actually true that day instead
--                                of whatever it is today. A day with no
--                                explicit entry defaults to "All Listed".
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as ebay_orders/ebay_listings (0280).
-- Run once in the Supabase SQL Editor, after 0280.
-- =====================================================================

create table if not exists ebay_branch_settings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  branch          text not null,
  assigned_to     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, branch)
);

create table if not exists ebay_branch_daily_notes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  branch          text not null,
  note_date       date not null,
  comment         text,
  listings_status text check (listings_status in ('Paused', 'All Listed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, branch, note_date)
);
create index if not exists idx_ebay_branch_daily_notes_date on ebay_branch_daily_notes(company_id, note_date);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function ebay_branch_settings_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_ebay_branch_settings_stamp on ebay_branch_settings;
create trigger trg_ebay_branch_settings_stamp before insert or update on ebay_branch_settings
  for each row execute function ebay_branch_settings_stamp();

create or replace function ebay_branch_daily_notes_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_ebay_branch_daily_notes_stamp on ebay_branch_daily_notes;
create trigger trg_ebay_branch_daily_notes_stamp before insert or update on ebay_branch_daily_notes
  for each row execute function ebay_branch_daily_notes_stamp();

-- ---------- RLS: company-scoped, same pattern as ebay_orders (0280) ----------
alter table ebay_branch_settings enable row level security;
alter table ebay_branch_settings force row level security;

drop policy if exists ebay_branch_settings_select on ebay_branch_settings;
create policy ebay_branch_settings_select on ebay_branch_settings
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_branch_settings_insert on ebay_branch_settings;
create policy ebay_branch_settings_insert on ebay_branch_settings
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_branch_settings_update on ebay_branch_settings;
create policy ebay_branch_settings_update on ebay_branch_settings
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_branch_settings_delete on ebay_branch_settings;
create policy ebay_branch_settings_delete on ebay_branch_settings
  for delete using (company_id = auth_company_id() or is_superadmin());

alter table ebay_branch_daily_notes enable row level security;
alter table ebay_branch_daily_notes force row level security;

drop policy if exists ebay_branch_daily_notes_select on ebay_branch_daily_notes;
create policy ebay_branch_daily_notes_select on ebay_branch_daily_notes
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_branch_daily_notes_insert on ebay_branch_daily_notes;
create policy ebay_branch_daily_notes_insert on ebay_branch_daily_notes
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_branch_daily_notes_update on ebay_branch_daily_notes;
create policy ebay_branch_daily_notes_update on ebay_branch_daily_notes
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ebay_branch_daily_notes_delete on ebay_branch_daily_notes;
create policy ebay_branch_daily_notes_delete on ebay_branch_daily_notes
  for delete using (company_id = auth_company_id() or is_superadmin());
