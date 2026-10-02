-- =====================================================================
-- 0345 — Clock-in code: 3 wrong entries count as 1 wrong try.
--
-- Typing the code wrong once or twice no longer counts against anyone:
-- every 3 wrong entries = 1 "wrong try". 5 wrong tries (15 wrong entries)
-- still lock that person until HR makes a new code.
--
-- Only redeem_clock_in_code changes. Run once in the Supabase SQL Editor,
-- after 0344.
-- =====================================================================

create or replace function redeem_clock_in_code(p_target uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  co uuid := auth_company_id();
  d date := clock_code_today();
  cur clock_in_daily_codes%rowtype;
  wrong_entries int;
  lock_after constant int := 15;  -- 5 wrong tries x 3 entries each
begin
  if me is null then return 'not_signed_in'; end if;
  if me <> p_target and chain_can_clock_in(me, p_target) is false then return 'not_allowed'; end if;
  if not exists (select 1 from profiles where id = p_target and company_id = co) then return 'not_allowed'; end if;

  select * into cur from clock_in_daily_codes where company_id = co and valid_date = d and not revoked;
  if not found then
    insert into clock_in_daily_codes (company_id, valid_date, code)
      values (co, d, lpad(floor(random() * 10000)::int::text, 4, '0'))
      on conflict (company_id, valid_date) where not revoked do nothing;
    return 'no_code';
  end if;

  select count(*) into wrong_entries from clock_in_code_events
    where profile_id = p_target and valid_date = d and not success and created_at >= cur.created_at;
  if wrong_entries >= lock_after then return 'locked'; end if;

  if cur.code <> trim(coalesce(p_code, '')) then
    insert into clock_in_code_events (company_id, valid_date, profile_id, entered_by, success) values (co, d, p_target, me, false);
    return case when wrong_entries + 1 >= lock_after then 'locked' else 'wrong' end;
  end if;
  insert into clock_in_code_events (company_id, valid_date, profile_id, entered_by, success) values (co, d, p_target, me, true);
  return 'ok';
end;
$$;
