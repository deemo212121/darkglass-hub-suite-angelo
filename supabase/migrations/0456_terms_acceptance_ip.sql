-- =====================================================================
-- 0456 — Terms & Conditions: where each acceptance came from (Sir Naveen,
-- 11/06: record the IP used to sign, and compare it with the IP they
-- usually use).
--
-- The accept window now records acceptances through /api/terms-accept
-- (src/lib/server/termsAccept.ts), which reads the IP from the same
-- Cloudflare header sign-ins use (login_events, 0089) — the browser can't
-- supply its own. Added to each acceptance:
--
--   email                        the sign-in email at the time (the terms'
--                                own list: name, email, user ID, time, version)
--   ip, ip_city, ip_region,
--   ip_country                   where it was accepted from
--   browser, user_agent          what it was accepted in
--   usual_ip                     the person's most-used sign-in IP over the
--                                last 90 days, at that moment
--   ip_matches                   ip = usual_ip (null with no sign-in history)
--
-- Admin → Pop up Forms → Who accepted shows them and flags a different IP
-- for HR to look at — it isn't refused (phone data vs. office Wi-Fi).
-- An acceptance made through terms_accept() directly (the fallback when the
-- server can't be reached) has these empty.
--
-- New nullable columns only — no data is touched. The existing
-- terms_acceptances policies already cover them. Run once in the Supabase
-- SQL Editor, after 0455.
-- =====================================================================

alter table terms_acceptances add column if not exists email      text;
alter table terms_acceptances add column if not exists ip         text;
alter table terms_acceptances add column if not exists ip_city    text;
alter table terms_acceptances add column if not exists ip_region  text;
alter table terms_acceptances add column if not exists ip_country text;
alter table terms_acceptances add column if not exists browser    text;
alter table terms_acceptances add column if not exists user_agent text;
alter table terms_acceptances add column if not exists usual_ip   text;
alter table terms_acceptances add column if not exists ip_matches boolean;

notify pgrst, 'reload schema';
