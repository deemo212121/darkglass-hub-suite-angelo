-- =====================================================================
-- 0103 — Force a password change on next login
--
-- AdminUserManagementPage.tsx's "Reset Password" (individual) and "Reset
-- All Passwords" (bulk) actions set this flag rather than pushing a new
-- password value directly to Firebase Auth. The user keeps logging in with
-- their EXISTING password; once signed in, __root.tsx's RootComponent
-- redirects them to /profile until they actually change it there (which
-- clears the flag) — see profile.tsx's changePassword().
--
-- Run once in the Supabase SQL Editor, after 0102.
-- =====================================================================

alter table profiles add column if not exists must_change_password boolean not null default false;
