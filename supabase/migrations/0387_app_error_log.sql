-- =====================================================================
-- 0387 — App error log (uploads & signing papers), for AHS Server Status.
--
-- When a file upload or a signing step fails for someone, the app saves
-- who, when, what they were doing, the error message and their device.
-- The Server Status page (SuperAdmin) shows them per person.
--
--  * Signed-in users insert their own rows; who they are (profile, name,
--    company) is filled in here from their session — never trusted from
--    the browser.
--  * Nobody reads them through the API except the server (service role,
--    /api/server-status, SuperAdmin only). RLS on, insert-only policy.
--  * Failures on the no-login signing links are written by the server
--    with the name the signer typed.
--  * Rows older than 30 days are pruned by the 5-minute status cron.
--
-- Run once in the Supabase SQL Editor.
-- (Numbered 0379 in Angelo's repo — renumbered here past this repo's own
-- 0379-0386; already applied to the shared database 2026-10-15. Safe to
-- run again.)
-- =====================================================================

create table if not exists app_error_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  company_id uuid,
  profile_id uuid,
  user_name text,
  area text not null check (area in ('upload', 'signing')),
  action text not null,
  message text,
  device text,
  page text
);
create index if not exists app_error_log_time_idx on app_error_log (created_at desc);
create index if not exists app_error_log_profile_idx on app_error_log (profile_id, created_at desc);
alter table app_error_log enable row level security;

create or replace function app_error_log_fill_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid := auth_profile_id();
begin
  if v_profile is not null then
    new.profile_id := v_profile;
    select p.company_id, coalesce(p.display_name, p.email) into new.company_id, new.user_name
    from profiles p where p.id = v_profile;
  end if;
  new.action := left(coalesce(new.action, ''), 300);
  new.message := left(new.message, 1000);
  new.device := left(new.device, 200);
  new.page := left(new.page, 300);
  return new;
end;
$$;

drop trigger if exists trg_app_error_log_fill_user on app_error_log;
create trigger trg_app_error_log_fill_user
  before insert on app_error_log
  for each row execute function app_error_log_fill_user();

drop policy if exists app_error_log_insert_own on app_error_log;
create policy app_error_log_insert_own on app_error_log
  for insert to authenticated
  with check (auth_profile_id() is not null);

grant insert on app_error_log to authenticated;
grant usage, select on sequence app_error_log_id_seq to authenticated;
