-- =====================================================================
-- 0360 — Coaching Log: "Send to CSR".
--
-- The coach sends the log to the person being coached (Team Messenger
-- message + bell notification, from the page). This records when it was
-- last sent and by whom, and adds a "sent" entry to the History tab.
-- Only the coach side (same rule as editing I/III/V) can mark it sent.
--
-- Adds two empty columns and updates trigger functions — no existing data
-- is changed. Run once in the Supabase SQL Editor, after 0359.
-- =====================================================================

alter table csr_coaching_logs add column if not exists sent_at timestamptz;
alter table csr_coaching_logs add column if not exists sent_by_name text;

create or replace function csr_coaching_logs_sent_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.sent_at, new.sent_by_name) is distinct from (old.sent_at, old.sent_by_name) then
    if not csr_coaching_can_manage(old.csr_profile_id, old.created_by) then
      new.sent_at := old.sent_at;
      new.sent_by_name := old.sent_by_name;
    elsif new.sent_at is not null then
      new.sent_at := now();
      new.sent_by_name := (select display_name from profiles where id = auth_profile_id());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_csr_coaching_logs_sent_guard on csr_coaching_logs;
create trigger trg_csr_coaching_logs_sent_guard
  before update on csr_coaching_logs
  for each row execute function csr_coaching_logs_sent_guard();

create or replace function csr_coaching_logs_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
  v_name text := (select display_name from profiles where id = v_me);
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_action := 'deleted';
  elsif new.deleted_at is null and old.deleted_at is not null then
    v_action := 'restored';
  elsif new.sent_at is distinct from old.sent_at and new.sent_at is not null then
    v_action := 'sent';
  elsif new.creator_signed_at is not null and old.creator_signed_at is null then
    v_action := 'creator_signed';
  elsif new.csr_signed_at is not null and old.csr_signed_at is null then
    v_action := 'csr_signed';
  else
    v_action := 'edited';
  end if;
  insert into csr_coaching_log_events (company_id, log_id, action, actor_id, actor_name)
  values (new.company_id, new.id, v_action, v_me, v_name);
  return null;
end;
$$;
