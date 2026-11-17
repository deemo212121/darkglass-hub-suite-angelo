-- =====================================================================
-- 0453 — Daily Mileage: the workbook's review fields, and more than one
-- trip per technician per day.
--
-- Finance's "Mileage Record Keeping" workbook keeps one row per trip, with
-- what's needed to check it before it's paid:
--   Total miles · Excluded miles + reason · Vehicle · Branch · Ticket #
--   · Mile Map links · Notes · Approval status (who approved, when)
-- Eligible miles = total − excluded. Car IQ, rate and pay are worked out by
-- the page from AHS (Car IQ history + rate history), not stored here.
--
-- Changes to tech_daily_mileage (0451):
--   * the one-row-per-day rule is dropped — a day can hold several trips
--   * new columns, all with defaults, so existing rows keep working
--   * the stamp trigger also records who approved / rejected a trip
--
-- Safe to run again. Run once in the Supabase SQL Editor, after 0451.
-- =====================================================================

alter table tech_daily_mileage drop constraint if exists tech_daily_mileage_company_id_profile_id_work_date_key;
create index if not exists idx_tech_daily_mileage_profile_date on tech_daily_mileage(profile_id, work_date);

alter table tech_daily_mileage add column if not exists excluded_miles   numeric(8,1) not null default 0;
alter table tech_daily_mileage add column if not exists exclusion_reason text not null default '';
alter table tech_daily_mileage add column if not exists vehicle          text not null default '';
alter table tech_daily_mileage add column if not exists branch           text not null default '';
alter table tech_daily_mileage add column if not exists ticket_refs      text not null default '';
alter table tech_daily_mileage add column if not exists total_map_url    text not null default '';
alter table tech_daily_mileage add column if not exists eligible_map_url text not null default '';
alter table tech_daily_mileage add column if not exists status           text not null default 'pending';
alter table tech_daily_mileage add column if not exists reviewed_by_name text;
alter table tech_daily_mileage add column if not exists reviewed_at      timestamptz;

alter table tech_daily_mileage drop constraint if exists tech_daily_mileage_excluded_check;
alter table tech_daily_mileage add constraint tech_daily_mileage_excluded_check check (excluded_miles >= 0 and excluded_miles <= miles);
alter table tech_daily_mileage drop constraint if exists tech_daily_mileage_status_check;
alter table tech_daily_mileage add constraint tech_daily_mileage_status_check check (status in ('pending', 'approved', 'rejected', 'needs_review'));

-- Same stamping as 0451, plus: changing the status records who did it and when
-- (cleared again when a trip goes back to pending).
create or replace function tech_daily_mileage_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id());
begin
  if tg_op = 'INSERT' then
    new.company_id := auth_company_id();
    new.created_by_name := v_name;
    new.created_at := now();
    if new.status <> 'pending' then
      new.reviewed_by_name := v_name;
      new.reviewed_at := now();
    else
      new.reviewed_by_name := null;
      new.reviewed_at := null;
    end if;
  else
    new.company_id := old.company_id;
    new.profile_id := old.profile_id;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
    if new.status is distinct from old.status then
      new.reviewed_by_name := case when new.status = 'pending' then null else v_name end;
      new.reviewed_at := case when new.status = 'pending' then null else now() end;
    else
      new.reviewed_by_name := old.reviewed_by_name;
      new.reviewed_at := old.reviewed_at;
    end if;
  end if;
  new.updated_by_name := v_name;
  new.updated_at := now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
