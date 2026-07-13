-- =====================================================================
-- 0053 — Company-wide Ticket Map provider setting
--
-- The Ticket Map (src/components/TicketListMap.tsx) can render on either
-- Google Maps JS API or Leaflet+OpenStreetMap. Which one is used is a
-- single company-wide choice (not a per-user preference), stored in the
-- existing companies.settings jsonb column as {"mapProvider": "google"}
-- or {"mapProvider": "leaflet"} — no new table needed.
--
-- Reading it needs no new policy: companies_select already lets any
-- authenticated user read their own company row (id = auth_company_id()).
-- Writing it is gated to that company's ADMIN/SUPERADMIN via this RPC
-- rather than widening the blanket companies_update policy (which is
-- currently is_superadmin()-only, covering every column including
-- subscription_plan) - this only ever touches the one jsonb key.
--
-- Run once in the Supabase SQL Editor, after 0052.
-- =====================================================================

create or replace function set_company_map_provider(p_provider text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_role text;
begin
  select company_id, role into v_company_id, v_role
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;

  if v_role is null or upper(v_role) not in ('ADMIN', 'SUPERADMIN') then
    raise exception 'Only an Admin can change the Ticket Map provider';
  end if;

  if p_provider not in ('google', 'leaflet') then
    raise exception 'Unknown map provider: %', p_provider;
  end if;

  update companies
  set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{mapProvider}', to_jsonb(p_provider))
  where id = v_company_id;
end;
$$;
