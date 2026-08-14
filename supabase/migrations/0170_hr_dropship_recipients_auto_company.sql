-- =====================================================================
-- 0170 — Fix hr_dropship_recipients.company_id: the client was passing
-- useAuth()'s companyId, which is actually the legacy Firebase-era
-- company code (e.g. "COMP001" — see profiles.companyId : legacyCode in
-- src/lib/supabase/users.ts), as the value for this uuid column, which
-- is really companies.id — "invalid input syntax for type uuid" on
-- every insert/select.
--
-- Same mismatch other tables in this schema avoid by never trusting a
-- client-supplied company_id and instead stamping it server-side from
-- the authenticated session — see hr_activity_log's own
-- hr_activity_log_stamp() trigger (0051), same idiom, reused here.
--
-- Run once in the Supabase SQL Editor, after 0169.
-- =====================================================================

create or replace function hr_dropship_recipients_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_dropship_recipients_stamp on hr_dropship_recipients;
create trigger trg_hr_dropship_recipients_stamp before insert on hr_dropship_recipients
  for each row execute function hr_dropship_recipients_stamp();
