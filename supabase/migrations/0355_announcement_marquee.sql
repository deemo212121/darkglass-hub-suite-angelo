-- ============================================================================
-- 0355 — Announcement ticker (marquee).
--
-- An announcement can be shown as a scrolling line under the app header for
-- everyone in the company. Each ticker item points at the announcement it
-- came from, carries its own short ticker text, and can end on a date.
-- Taking one down stamps removed_* instead of deleting, so it stays on
-- record. Only the roles that can post announcements can add or remove
-- ticker items; everyone in the company can read them.
-- ============================================================================

create or replace function can_post_announcements()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (
        role in ('SUPERADMIN','ADMIN','MANAGER','SENIOR_MANAGER','HR','BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
                 'CSR_MANAGER','CLAIMS_MANAGER','PARTS_MANAGER','BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER')
        or extra_roles && array['SUPERADMIN','ADMIN','MANAGER','SENIOR_MANAGER','HR','BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
                 'CSR_MANAGER','CLAIMS_MANAGER','PARTS_MANAGER','BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER']::text[]
      )
  );
$$;

create table if not exists announcement_marquees (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  message_id       uuid references messages(id) on delete cascade,
  text             text not null check (length(btrim(text)) > 0),
  ends_at          timestamptz,
  created_by       uuid references profiles(id) on delete set null default auth_profile_id(),
  created_by_name  text,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by_name  text
);

create index if not exists idx_announcement_marquees_company
  on announcement_marquees(company_id, created_at desc);

drop trigger if exists trg_announcement_marquees_company on announcement_marquees;
create trigger trg_announcement_marquees_company
  before insert on announcement_marquees
  for each row execute function set_company_id();

alter table announcement_marquees enable row level security;

drop policy if exists announcement_marquees_select on announcement_marquees;
create policy announcement_marquees_select on announcement_marquees
  for select using (company_id = auth_company_id());

drop policy if exists announcement_marquees_insert on announcement_marquees;
create policy announcement_marquees_insert on announcement_marquees
  for insert with check (can_post_announcements());

drop policy if exists announcement_marquees_update on announcement_marquees;
create policy announcement_marquees_update on announcement_marquees
  for update using (company_id = auth_company_id() and can_post_announcements())
  with check (company_id = auth_company_id());

-- ----------------------------------------------------------------------------
-- Announcement titles. Kept in their own table (not a new messages column)
-- so the chat queries, which name their columns, are untouched. One title
-- per announcement; the ticker shows the title.
-- ----------------------------------------------------------------------------
create table if not exists announcement_titles (
  message_id       uuid primary key references messages(id) on delete cascade,
  company_id       uuid not null references companies(id) on delete cascade,
  title            text not null check (length(btrim(title)) > 0),
  updated_by_name  text,
  updated_at       timestamptz not null default now()
);

drop trigger if exists trg_announcement_titles_company on announcement_titles;
create trigger trg_announcement_titles_company
  before insert on announcement_titles
  for each row execute function set_company_id();

alter table announcement_titles enable row level security;

drop policy if exists announcement_titles_select on announcement_titles;
create policy announcement_titles_select on announcement_titles
  for select using (company_id = auth_company_id());

drop policy if exists announcement_titles_insert on announcement_titles;
create policy announcement_titles_insert on announcement_titles
  for insert with check (can_post_announcements());

drop policy if exists announcement_titles_update on announcement_titles;
create policy announcement_titles_update on announcement_titles
  for update using (company_id = auth_company_id() and can_post_announcements())
  with check (company_id = auth_company_id());

-- ----------------------------------------------------------------------------
-- Ticker on/off. Each line can be deactivated (kept, just not shown) and
-- re-activated; the whole ticker can be switched off for the company.
-- ----------------------------------------------------------------------------
alter table announcement_marquees add column if not exists is_active boolean not null default true;

create table if not exists announcement_marquee_settings (
  company_id       uuid primary key references companies(id) on delete cascade,
  enabled          boolean not null default true,
  updated_by_name  text,
  updated_at       timestamptz not null default now()
);

alter table announcement_marquee_settings enable row level security;

drop policy if exists announcement_marquee_settings_select on announcement_marquee_settings;
create policy announcement_marquee_settings_select on announcement_marquee_settings
  for select using (company_id = auth_company_id());

-- Writes go through this function (it knows the caller's company).
create or replace function set_ticker_enabled(p_enabled boolean, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_post_announcements() then
    raise exception 'Only the roles that can post announcements can switch the ticker on or off';
  end if;
  insert into announcement_marquee_settings (company_id, enabled, updated_by_name, updated_at)
  values (auth_company_id(), p_enabled, p_by_name, now())
  on conflict (company_id) do update
    set enabled = excluded.enabled, updated_by_name = excluded.updated_by_name, updated_at = now();
end;
$$;

grant execute on function set_ticker_enabled(boolean, text) to authenticated;
