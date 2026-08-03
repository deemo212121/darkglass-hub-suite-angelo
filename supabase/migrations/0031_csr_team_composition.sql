-- =====================================================================
-- 0031 — CSR Team Composition
--
-- Ported from upstream (janeyyy16/usapp)'s 0027_csr_team_composition.sql —
-- renumbered to 0031 here since this project's own migration sequence had
-- already used 0027-0030 for unrelated fixes (pto_requests/attendance_notes
-- profile links, timecard_corrections, the partial-unique-index ON CONFLICT
-- fix, and expenses.profile_id) by the time this one was pulled in.
--
-- Moves the CSR Dashboard's "Team Composition" tool off in-memory React
-- state into Supabase so team/leader/agent assignments survive a reload
-- and are shared company-wide instead of resetting per browser session.
--
-- csr_teams          one row per team (name, color, display order)
-- csr_team_members   one row per staff member currently placed on a team
--                     (profile_id, is_leader). A profile with no row here
--                     is "unassigned" and shows up in the roster instead.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session, same pattern as location_mgmt_* (0003).
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists csr_teams (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  color       text not null default '#3b82f6',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_csr_teams_company on csr_teams(company_id);

create table if not exists csr_team_members (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  team_id     uuid not null references csr_teams(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  is_leader   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (profile_id)
);
create index if not exists idx_csr_team_members_company on csr_team_members(company_id);
create index if not exists idx_csr_team_members_team on csr_team_members(team_id);

-- ---------- Auto-stamp company_id from the caller's session ----------
create or replace function csr_teams_stamp_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_csr_teams_stamp on csr_teams;
create trigger trg_csr_teams_stamp before insert on csr_teams
  for each row execute function csr_teams_stamp_company();

drop trigger if exists trg_csr_team_members_stamp on csr_team_members;
create trigger trg_csr_team_members_stamp before insert on csr_team_members
  for each row execute function csr_teams_stamp_company();

-- ---------- RLS: company-scoped, same pattern as the rest of the platform ----------
do $$
declare t text;
begin
  foreach t in array array['csr_teams', 'csr_team_members'] loop
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
