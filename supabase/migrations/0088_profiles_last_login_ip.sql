-- =====================================================================
-- 0088_profiles_last_login_ip.sql
--
-- Track the IP address a user most recently logged in from, alongside
-- the existing last_login timestamp. Same "most recent value only, no
-- history" shape as last_login itself — not a per-login audit log.
--
-- Set from api/supabase-token.ts (the Firebase -> Supabase token bridge,
-- which runs server-side on every login and has the real client IP via
-- the CF-Connecting-IP header Cloudflare adds to every request).
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table profiles add column if not exists last_login_ip text;
