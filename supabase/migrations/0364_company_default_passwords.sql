-- =====================================================================
-- 0364 — Default password, set by Admin in the app.
--
-- One row per company: the default password used when an account is
-- created (Admin User Management → Add User), reset by Admin/HR ("Reset to
-- default"), or reset from the login screen (Forgot Password). Admin /
-- SuperAdmin set it under Login Security → Default Password; the page can
-- set it but never shows it back.
--
-- Only the server (service-role key — defaultPasswordBridge.ts) reads or
-- writes this table: RLS is on with NO policies, so signed-in users can't
-- select it, even Admins. The server needs the real value because the
-- reset emails contain it.
--
-- Until a company sets one, the server falls back to the
-- DEFAULT_RESET_PASSWORD secret (.env / Cloudflare), if that's set.
--
-- Run once in the Supabase SQL Editor, after 0363.
-- =====================================================================

create table if not exists company_default_passwords (
  company_id uuid primary key references companies(id) on delete cascade,
  password text not null check (char_length(password) between 8 and 64),
  updated_by uuid references profiles(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

alter table company_default_passwords enable row level security;
