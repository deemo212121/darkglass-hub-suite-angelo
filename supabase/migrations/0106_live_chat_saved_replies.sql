-- =====================================================================
-- 0106 — Live Chat: saved (canned) replies
--
-- Company-wide, not personal — any CSR can create one and any CSR can use
-- (or edit/delete) any other's, same low-friction "shared team utility"
-- level of permissiveness as the rest of this platform's company-scoped
-- tables (e.g. profiles_update lets any company member update any
-- profile). company_id/created_by auto-stamped from the caller's session,
-- same pattern as csr_agent_notes (0040).
--
-- Run once in the Supabase SQL Editor, after 0105.
--
-- NOTE: unlike the rest of this file's original design, the 4 policies
-- below intentionally do NOT OR in is_superadmin() — 0100_platform_admin_
-- data_lockdown.sql stripped that unconditional platform-role bypass from
-- every company-data table except companies/profiles, and this table is
-- brand new as of this same merge, so it's created already conforming to
-- that (company_id = auth_company_id() only).
-- =====================================================================

create table if not exists live_chat_saved_replies (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  created_by  uuid references profiles(id) on delete set null,
  label       text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_live_chat_saved_replies_company on live_chat_saved_replies(company_id, created_at);

create or replace function live_chat_saved_replies_stamp_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.created_by is null then
    new.created_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_live_chat_saved_replies_stamp on live_chat_saved_replies;
create trigger trg_live_chat_saved_replies_stamp before insert on live_chat_saved_replies
  for each row execute function live_chat_saved_replies_stamp_company();

alter table live_chat_saved_replies enable row level security;
alter table live_chat_saved_replies force row level security;

drop policy if exists live_chat_saved_replies_select on live_chat_saved_replies;
create policy live_chat_saved_replies_select on live_chat_saved_replies
  for select using (company_id = auth_company_id());

drop policy if exists live_chat_saved_replies_insert on live_chat_saved_replies;
create policy live_chat_saved_replies_insert on live_chat_saved_replies
  for insert with check (company_id = auth_company_id());

drop policy if exists live_chat_saved_replies_update on live_chat_saved_replies;
create policy live_chat_saved_replies_update on live_chat_saved_replies
  for update using (company_id = auth_company_id())
              with check (company_id = auth_company_id());

drop policy if exists live_chat_saved_replies_delete on live_chat_saved_replies;
create policy live_chat_saved_replies_delete on live_chat_saved_replies
  for delete using (company_id = auth_company_id());
