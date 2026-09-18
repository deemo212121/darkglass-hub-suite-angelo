-- =====================================================================
-- 0268 — Flash Tech "trip turned Open" auto-email
--
-- Two pieces:
--   1. A new connectable Gmail slot, "FLASH_TECH" — same
--      hr_gmail_connections idiom as 0113/0168/0173/0217/0251 (only the
--      table's own CHECK constraint restricts the allowed region values).
--      Connected from the Flash Tech page itself (FlashTechCalendarPage.tsx).
--   2. A single company-wide, HR/Admin-editable recipient address for the
--      alert — same companies.settings jsonb + RPC pattern as 0067's
--      defaultTechnician setting. Comma-separated for more than one
--      recipient; validated only client-side (a free-typed setting, same
--      trust level as defaultTechnician).
--   3. flash_tech_trips.open_alert_sent_at — dedup marker so the cron job
--      (src/lib/server/flashTechOpenAlerts.ts) only ever emails once per
--      trip's Upcoming->Open transition, not once per hourly tick.
--
-- Run once in the Supabase SQL Editor, after 0267.
-- =====================================================================

alter table hr_gmail_connections drop constraint if exists hr_gmail_connections_region_check;
alter table hr_gmail_connections add constraint hr_gmail_connections_region_check
  check (region in ('US', 'PH', 'PARTS', 'IT_1', 'IT_2', 'IT_3', 'ATTENDANCE', 'HR_HIRING', 'FLASH_TECH'));

alter table flash_tech_trips add column if not exists open_alert_sent_at timestamptz;

create or replace function set_flash_tech_open_alert_email(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN', 'HR') then
    raise exception 'Only HR/Admin can set the Flash Tech alert recipient';
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{flashTechOpenAlertEmail}', to_jsonb(p_email))
  where id = v_company_id;
end;
$$;
