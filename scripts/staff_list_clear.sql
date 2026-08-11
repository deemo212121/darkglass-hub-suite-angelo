-- =====================================================================
-- Staff List cleanup — clears every value that came from the Excel
-- import (the 4 backfilled per-person fields, plus the Current Staff and
-- Tier Level reference tables), so Staff List is 100% Master List data
-- going forward with nothing left over from the spreadsheet. The page's
-- columns/tabs stay — they'll just be empty until edited fresh from here
-- or re-populated some other way.
--
-- Run once in the Supabase SQL Editor, whenever you want a clean slate.
-- =====================================================================

do $$
declare
  cid uuid;
begin
  select id into cid from companies where legacy_code = 'COMP001';
  if cid is null then
    return;
  end if;

  update profiles
    set personal_email = null, work_phone = null, tier_level = null, staff_note = null
    where company_id = cid;

  delete from staff_list_current_staff where company_id = cid;
  delete from staff_list_tier_level where company_id = cid;
end $$;
