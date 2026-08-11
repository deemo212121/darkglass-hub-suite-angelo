-- =====================================================================
-- 0147 — Which zone a person's Required Schedule (required_check_in /
-- required_check_out) is actually in.
--
-- Branches span both Central and Eastern time — the Master List's "Hours
-- of Work" column edits required_check_in/out directly, so without this
-- there's no way to tell whether "8:00 AM" on file means Central or
-- Eastern. Defaults to CST since that's the app's existing reference zone
-- (see Header.tsx's clock).
--
-- Run once in the Supabase SQL Editor, after 0146.
-- =====================================================================

alter table profiles add column if not exists schedule_timezone text not null default 'CST'
  check (schedule_timezone in ('CST', 'EST'));
