-- =====================================================================
-- 0083 — Optional Discord notification per custom form
--
-- HR can paste a Discord "Incoming Webhook" URL (Channel Settings >
-- Integrations > Webhooks > New Webhook > Copy Webhook URL, no bot or
-- OAuth needed) onto a form; every new submission then posts a message
-- to that channel with the submitter's name and their answers — see
-- src/lib/server/discordNotify.ts.
--
-- Nullable, no default — most forms won't have one. Never exposed on the
-- public (anonymous) form-fetch response, since the URL itself functions
-- as a bearer credential for that channel (see customFormsBridge.ts's
-- GET handler, which intentionally does not return this column).
--
-- Run once in the Supabase SQL Editor, after 0082.
-- =====================================================================

alter table hr_custom_forms add column if not exists discord_webhook_url text;
