-- Fix: scheduled/cron writes that authenticate with the raw service role
-- key have every explicitly-provided company_id silently clobbered to NULL
-- by set_company_id() (0001_init.sql), causing a hard NOT NULL constraint
-- failure on every insert.
--
-- set_company_id() already has a trusted-caller bypass for is_superadmin()
-- ("if the caller is a superadmin AND already supplied a company_id, keep
-- it"). auth_company_id()/is_superadmin() both resolve via
-- current_setting('request.jwt.claims')::json->>'sub' — a service-role
-- key has no 'sub' claim at all (Supabase service role JWTs only carry
-- role: "service_role"), so BOTH resolve to false/null for a service-role
-- request, and the trigger always overwrites with NULL regardless of what
-- was actually passed in.
--
-- Concretely: src/lib/server/attendanceAlerts.ts's "*/5 * * * *" cron
-- (missing clock-in/out alerts) authenticates as the service role and
-- explicitly sets notifications.company_id correctly — but the trigger on
-- that table (0035_notifications.sql) stomps it to NULL every time, so
-- every attendance-alert notification has been silently failing to send
-- (100% failure rate) since that trigger was added. Confirmed via
-- Supabase's Postgres logs: recurring bursts of
-- 'null value in column "company_id" of relation "notifications" violates
-- not-null constraint', on a 5-minute cadence matching the cron.
--
-- Fix: extend the same trusted-caller bypass to the service role. This is
-- safe — service_role already bypasses RLS entirely on every table
-- regardless of this trigger, so trusting a company_id it explicitly
-- provides doesn't weaken any actual security boundary, it just stops a
-- correct value from being needlessly discarded. Since set_company_id()
-- is shared by every tenant table (not just notifications), this also
-- self-corrects the same latent class of bug anywhere else it may exist,
-- not just the one confirmed call site.
--
-- Run once in the Supabase SQL Editor.

create or replace function set_company_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (
    is_superadmin()
    or current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  ) and new.company_id is not null then
    return new;
  end if;
  new.company_id := auth_company_id();
  return new;
end;
$$;
