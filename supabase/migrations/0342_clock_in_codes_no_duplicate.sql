-- =====================================================================
-- 0342 — Clock-in codes: fix "duplicate key value violates unique
-- constraint clock_in_codes_live_uidx".
--
-- Opening HR → Clock-In Codes twice at the same moment (two HR users, or
-- the page loading twice) made both calls insert today's code for the same
-- technician; the second one failed. Now a code that already exists is
-- simply skipped. Regenerating is made safe the same way.
--
-- Run once in the Supabase SQL Editor, after 0341.
-- =====================================================================

create or replace function ensure_daily_clock_in_codes()
returns date language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  co uuid := auth_company_id();
  d date := clock_code_today();
begin
  if me is null or not clock_code_issuer() then
    raise exception 'Only HR can see clock-in codes.';
  end if;
  insert into clock_in_codes (company_id, profile_id, code, valid_date, created_by)
  select co, p.id, lpad(floor(random() * 10000)::int::text, 4, '0'), d, null
  from profiles p
  where p.company_id = co
    and p.is_active
    and chain_level_held(p.role, p.extra_roles) = 'tech'
    and chain_norm_branch(p.assigned_branch) <> 'philippines'
  on conflict (profile_id, valid_date) where revoked_reason is null do nothing;
  return d;
end;
$$;

create or replace function regenerate_clock_in_code(p_target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  co uuid := auth_company_id();
  d date := clock_code_today();
  c text := lpad(floor(random() * 10000)::int::text, 4, '0');
begin
  if me is null or not clock_code_issuer() then
    raise exception 'Only HR can regenerate clock-in codes.';
  end if;
  if not exists (select 1 from profiles where id = p_target and company_id = co) then
    raise exception 'That employee is not in your company.';
  end if;
  -- Serialize regenerations for this technician so two clicks can't collide.
  perform pg_advisory_xact_lock(hashtext('clock_in_code:' || p_target::text));
  update clock_in_codes set revoked_reason = 'replaced'
    where profile_id = p_target and valid_date = d and revoked_reason is null;
  insert into clock_in_codes (company_id, profile_id, code, valid_date, created_by)
    values (co, p_target, c, d, me);
  return c;
end;
$$;
