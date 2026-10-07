-- =====================================================================
-- 0363 — Forgot Password: emailed confirmation codes.
--
-- "Forgot password?" now emails a 6-digit code to the address on file
-- first; the password is only reset once that code is typed back. One row
-- per code sent. Only the code's SHA-256 hash is stored, never the code.
-- A code is valid for 24 hours, works once (used_at), and stops working
-- after 5 wrong tries (attempts).
--
-- Only the server (service-role key, passwordResetRequestBridge.ts) reads
-- or writes this table — RLS is on with no policies, so the app's normal
-- signed-in users can't see it at all.
--
-- Run once in the Supabase SQL Editor, after 0362.
-- =====================================================================

create table if not exists password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_codes_profile_idx
  on password_reset_codes (profile_id, created_at desc);

alter table password_reset_codes enable row level security;
