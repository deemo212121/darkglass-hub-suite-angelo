-- =====================================================================
-- 0174 — Log every Parts hub "Done" button click, for the Parts Order
-- Dashboard's new "Done Activity" tab.
--
-- The app has two separate notification delivery backends (Firestore
-- per-uid subcollections, and a Supabase table — see partsNotify.ts's
-- own header comment), neither of which is a practical place to query
-- "every Done click today, company-wide" from — Firestore has no
-- company-wide index for it, and the Supabase notifications table is
-- keyed per-recipient, not per-send. So this is a lightweight
-- write-through log: m.$module.tsx's confirmImDone inserts one row here
-- per branch, right alongside the actual "Parts done" notification send,
-- so the dashboard tab can show the same events that went out as
-- notifications without re-deriving them from either backend.
--
-- company_id is server-stamped (never trusted from the client) — same
-- fix as hr_dropship_recipients (0169/0170) for the same
-- useAuth().companyId-is-a-legacy-code trap.
--
-- Run once in the Supabase SQL Editor, after 0173.
-- =====================================================================

create table if not exists parts_done_activity_log (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  branch           text not null,
  summary          text not null,
  recipient_count  int not null default 0,
  actor_name       text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_parts_done_activity_log_company on parts_done_activity_log(company_id, created_at desc);

alter table parts_done_activity_log enable row level security;
alter table parts_done_activity_log force row level security;

create or replace function parts_done_activity_log_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_parts_done_activity_log_stamp on parts_done_activity_log;
create trigger trg_parts_done_activity_log_stamp before insert on parts_done_activity_log
  for each row execute function parts_done_activity_log_stamp();

drop policy if exists parts_done_activity_log_select on parts_done_activity_log;
create policy parts_done_activity_log_select on parts_done_activity_log
  for select using (company_id = auth_company_id() or is_superadmin());

-- Any authenticated company member can insert — Done is clicked by
-- ordinary Parts/branch staff, not an admin-only operation.
drop policy if exists parts_done_activity_log_insert on parts_done_activity_log;
create policy parts_done_activity_log_insert on parts_done_activity_log
  for insert with check (company_id = auth_company_id() or is_superadmin());
