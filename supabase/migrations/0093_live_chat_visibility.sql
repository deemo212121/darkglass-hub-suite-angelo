-- =====================================================================
-- 0093 — Tiered visibility for the Live Chat queue
--
-- CSR Agents and Team Leaders should only see chats they can act on: the
-- open (unclaimed) queue, plus whatever's assigned to them personally.
-- Team Leaders additionally see chats assigned to anyone on the team they
-- lead — determined by csr_team_members.is_leader (0031), the same data
-- CSRTeamLeaderDashboard.tsx already reads, NOT the profiles.role value
-- (Team Composition can flag anyone as a team's leader regardless of
-- their primary role). CSR Manager, BizOps Manager/Senior Manager, and
-- Admin get unrestricted company-wide visibility for monitoring.
--
-- Enforced at the RLS level rather than just hidden in the UI — this is
-- about who's allowed to see a customer's conversation, not just who's
-- allowed to reply to it.
--
-- Run once in the Supabase SQL Editor, after 0092.
-- =====================================================================

-- Checks role OR extra_roles, same "primary-or-secondary" convention as
-- hasDashboardAccess() on the client (src/lib/dashboardAccess.ts).
create or replace function is_csr_wide_visibility()
returns boolean language sql stable security definer set search_path = public as $$
  select
    upper(role) in ('ADMIN', 'SUPERADMIN', 'CSR_MANAGER', 'BIZOPS_MANAGER', 'BIZOPS_SENIOR_MANAGER')
    or exists (
      select 1 from unnest(coalesce(extra_roles, '{}')) r
      where upper(r) in ('ADMIN', 'SUPERADMIN', 'CSR_MANAGER', 'BIZOPS_MANAGER', 'BIZOPS_SENIOR_MANAGER')
    )
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;

-- Every profile id on any team the caller leads. Returns an empty set for
-- anyone not currently marked as a team leader in Team Composition — safe
-- to OR into a policy unconditionally, no separate "am I a leader" check
-- needed to use it.
create or replace function my_csr_team_member_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select tm2.profile_id
  from csr_team_members tm1
  join csr_team_members tm2 on tm2.team_id = tm1.team_id
  where tm1.profile_id = auth_profile_id() and tm1.is_leader = true;
$$;

drop policy if exists live_chat_sessions_select on live_chat_sessions;
create policy live_chat_sessions_select on live_chat_sessions
  for select using (
    is_superadmin()
    or (
      company_id = auth_company_id()
      and (
        is_csr_wide_visibility()
        or assigned_to is null
        or assigned_to = auth_profile_id()
        or assigned_to in (select my_csr_team_member_ids())
      )
    )
  );

-- Messages inherit visibility from their session — live_chat_sessions' own
-- RLS (above) already filters which sessions this subquery can see, so
-- there's no need to duplicate the same tier logic here.
drop policy if exists live_chat_messages_select on live_chat_messages;
create policy live_chat_messages_select on live_chat_messages
  for select using (
    exists (select 1 from live_chat_sessions s where s.id = live_chat_messages.session_id)
  );
