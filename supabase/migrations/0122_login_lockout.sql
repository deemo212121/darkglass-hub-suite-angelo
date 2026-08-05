-- =====================================================================
-- 0122 — Login lockout after repeated failed attempts
--
-- Tracks failed sign-in attempts per account so a real (server-enforced,
-- not just client-side) lock can kick in after 5 fails — see
-- src/lib/server/loginLockoutBridge.ts, wired into the login flow from
-- src/lib/auth.tsx's login(). Surfaced to admins on the "Login Lockouts"
-- tile (src/components/LoginLockoutsPage.tsx), a sibling to "Login Security".
--
-- No RLS changes needed: loginLockoutBridge.ts runs pre-authentication (the
-- caller has no Supabase session yet at check/failure time) using
-- SUPABASE_SERVICE_KEY, same as supabaseTokenBridge.ts already does. The
-- admin-facing "Unlock Now" action goes through the normal authenticated
-- client and existing profiles RLS, so it needs no special policy either.
--
-- Run once in the Supabase SQL Editor, after 0121.
-- =====================================================================

alter table profiles add column if not exists failed_login_count int not null default 0;
alter table profiles add column if not exists locked_until timestamptz;
