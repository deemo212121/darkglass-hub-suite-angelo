-- =====================================================================
-- 0421 — Keep the Absent List's HR Status in step with leave requests.
--
-- A leave day lived in two places that never talked to each other: the
-- leave request (pto_requests — what payroll pays) and HR's Absent List
-- mark (attendance_notes.hr_note). HR could mark a day "Personal" and the
-- employee's Vacation request for it could be approved later, leaving the
-- two disagreeing (payroll paid it, the Attendance table showed it unpaid).
--
-- The request is now the source of truth for its days:
--   * approved      → each working day in its range gets hr_note set to the
--                     request's type (Vacation / Sick / Personal / …),
--                     replacing an empty, leave-type or Unnoticed mark —
--                     never Resigned/Terminated/Admin/etc.
--   * no longer approved (denied, cancelled, reset, deleted), or its
--     dates/type edited → the marks it set on its old days are cleared,
--     unless another approved request still covers that day.
-- Working days follow the profile's off_days (default Sat/Sun), same as
-- leaveHoursFor in pto.ts.
--
-- Also fixes existing marks that contradict an approved request (no new
-- rows are created for past requests).
--
-- Run once in the Supabase SQL Editor, after 0420.
-- =====================================================================

create or replace function pto_type_hr_status(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'vacation' then 'Vacation'
    when 'sick' then 'Sick'
    when 'personal' then 'Personal'
    when 'holiday' then 'Holiday'
    when 'unpaid' then 'Unpaid'
    when 'bereavement' then 'Bereavement'
  end;
$$;

-- Marks an approved request may overwrite.
create or replace function hr_status_is_replaceable(p_note text)
returns boolean language sql immutable as $$
  select coalesce(nullif(trim(p_note), ''), '') in
    ('', 'Vacation', 'Sick', 'Personal', 'Holiday', 'Unpaid', 'Bereavement', 'Unnoticed', 'Absent');
$$;

-- Working days of [p_start, p_end] for a profile.
create or replace function pto_working_days(p_profile uuid, p_start date, p_end date)
returns setof date language sql stable as $$
  select d::date
  from generate_series(p_start, p_end, interval '1 day') d
  where extract(dow from d)::int <> all (
    coalesce(
      (select case when cardinality(off_days) > 0 then off_days end from profiles where id = p_profile),
      array[0, 6]
    )
  );
$$;

create or replace function sync_pto_absent_list()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_label text;
  v_new_label text;
begin
  -- Clear what the old version set, when it stops applying as it was.
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'approved' and old.profile_id is not null
     and (tg_op = 'DELETE'
          or new.status is distinct from 'approved'
          or new.pto_type is distinct from old.pto_type
          or new.start_date is distinct from old.start_date
          or new.end_date is distinct from old.end_date) then
    v_old_label := pto_type_hr_status(old.pto_type);
    update attendance_notes n
       set hr_note = null
     where n.profile_id = old.profile_id
       and n.note_date between old.start_date and old.end_date
       and n.hr_note = v_old_label
       and not exists (
         select 1 from pto_requests r
          where r.profile_id = old.profile_id
            and r.id <> old.id
            and r.status = 'approved'
            and pto_type_hr_status(r.pto_type) = v_old_label
            and n.note_date between r.start_date and r.end_date
       );
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.status = 'approved' and new.profile_id is not null then
    v_new_label := pto_type_hr_status(new.pto_type);
    if v_new_label is not null then
      insert into attendance_notes (company_id, profile_id, note_date, hr_note)
      select new.company_id, new.profile_id, d, v_new_label
        from pto_working_days(new.profile_id, new.start_date, new.end_date) d
      on conflict (profile_id, note_date) do update
        set hr_note = excluded.hr_note
        where hr_status_is_replaceable(attendance_notes.hr_note);
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_pto_sync_absent_list on pto_requests;
create trigger trg_pto_sync_absent_list
  after insert or update or delete on pto_requests
  for each row execute function sync_pto_absent_list();

-- One-time: fix existing marks that contradict an approved request.
update attendance_notes n
   set hr_note = pto_type_hr_status(r.pto_type)
  from pto_requests r
 where r.status = 'approved'
   and r.profile_id = n.profile_id
   and n.note_date between r.start_date and r.end_date
   and n.note_date in (select pto_working_days(r.profile_id, r.start_date, r.end_date))
   and pto_type_hr_status(r.pto_type) is not null
   and n.hr_note is distinct from pto_type_hr_status(r.pto_type)
   and nullif(trim(n.hr_note), '') is not null
   and hr_status_is_replaceable(n.hr_note);
