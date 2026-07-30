-- =====================================================================
-- 0089 — Fix Live Chat "Transfer" blocked by RLS
--
-- live_chat_sessions_update's WITH CHECK had drifted to reuse the same
-- tiered visibility expression as live_chat_sessions_select (0080) — i.e.
-- it required the NEW assigned_to value to be visible to the caller
-- (self, unclaimed, a team they lead, or a wide-visibility role). That's
-- correct for viewing a chat, but wrong for reassigning one: Transfer's
-- whole point is handing a chat to someone OUTSIDE the caller's own
-- visibility (a different team, a specialist, etc). Only CSR Managers/
-- Admins (wide visibility) could actually transfer to a genuine third
-- party; agents and team leaders could only "transfer" to themselves or
-- their own team.
--
-- Fix: WITH CHECK only needs to confirm the row stays in the caller's
-- company (or superadmin) — same as the original 0078 design — with no
-- restriction on who the new assigned_to is. USING stays as-is: you still
-- need to currently see a chat (via the tiered SELECT rule) to act on it
-- at all.
--
-- Run once in the Supabase SQL Editor, after 0088.
-- =====================================================================

drop policy if exists live_chat_sessions_update on live_chat_sessions;
create policy live_chat_sessions_update on live_chat_sessions
  for update
  using (
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
  )
  with check (
    company_id = auth_company_id() or is_superadmin()
  );
