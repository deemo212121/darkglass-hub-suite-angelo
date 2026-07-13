-- =====================================================================
-- 0051 — HR Activity Log
--
-- Company-wide audit trail of actions taken in the HR & Recruitment
-- Dashboard (candidates, warnings, onboarding documents, certificates,
-- warning forms, staffing targets, employee status changes, etc.).
-- `action` is a short free-text code (e.g. "candidate_added",
-- "warning_confirmed") rather than an enum, so new action types can be
-- logged without a schema change — same free-text treatment as
-- position/branch elsewhere in this schema.
--
-- Run once in the Supabase SQL Editor, after 0050.
-- =====================================================================

create table if not exists hr_activity_log (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  actor_id      uuid references profiles(id),
  action        text not null,
  target_type   text,
  target_id     text,
  target_label  text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_hr_activity_log_company on hr_activity_log(company_id, created_at desc);
create index if not exists idx_hr_activity_log_actor on hr_activity_log(actor_id, created_at desc);

create or replace function hr_activity_log_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.actor_id is null then
    new.actor_id := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_activity_log_stamp on hr_activity_log;
create trigger trg_hr_activity_log_stamp before insert on hr_activity_log
  for each row execute function hr_activity_log_stamp();

-- ---------- RLS: company-wide read (it's an audit log everyone in HR can
-- see), insert-only otherwise — entries are never edited or deleted, so
-- the trail can't be tampered with after the fact. ----------
alter table hr_activity_log enable row level security;
alter table hr_activity_log force row level security;

drop policy if exists hr_activity_log_select on hr_activity_log;
create policy hr_activity_log_select on hr_activity_log
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_activity_log_insert on hr_activity_log;
create policy hr_activity_log_insert on hr_activity_log
  for insert with check (company_id = auth_company_id() or is_superadmin());
