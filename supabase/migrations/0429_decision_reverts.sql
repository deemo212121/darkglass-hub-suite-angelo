-- =====================================================================
-- 0429 — Revert a decision, with a note
--
-- A decision goes back to Pending only through the functions below, which
-- check that the caller is the person who made that decision or a Super
-- Admin, and require a note. Every revert is one row in decision_reverts:
-- what was reverted, who decided it, who reverted it and why. That table
-- backs the note shown on each record and the Super Admin's Reverts tab,
-- and it's built to take more kinds of record later (record_type).
--
-- First two kinds:
--   Time-Off (pto_requests): one step at a time (Manager / HR / Accounting).
--     The existing triggers recompute the request's status (any two of
--     three approve) and clear the Absent List mark if it's no longer
--     approved.
--   Ticket Dispute (employee_requests): back to Pending, and the ticket's
--     on-site times go back to what they were. Approving overwrote those
--     without keeping a copy, so three new columns now save them just before
--     approval. A dispute approved before this has no copy, so its status
--     goes back but the ticket's times stay as they are.
--
-- New table and new columns only; no existing data is changed. Safe to
-- rerun. Run once in the Supabase SQL Editor, after 0428.
-- =====================================================================

create table if not exists decision_reverts (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id) on delete cascade,
  record_type              text not null,
  record_id                uuid not null,
  -- 'manager' / 'hr' / 'accounting' on a multi-step record, null otherwise.
  stage                    text,
  subject_profile_id       uuid references profiles(id) on delete set null,
  subject_name             text,
  -- What it was about, e.g. "Vacation 2026-11-10 to 2026-11-12" or "Ticket 12345".
  label                    text,
  previous_status          text not null,
  previous_decided_by      uuid references profiles(id) on delete set null,
  previous_decided_by_name text,
  previous_note            text,
  reverted_by              uuid references profiles(id) on delete set null,
  reverted_by_name         text,
  note                     text not null check (length(btrim(note)) > 0),
  details                  jsonb not null default '{}',
  created_at               timestamptz not null default now()
);
create index if not exists idx_decision_reverts_company on decision_reverts(company_id, created_at desc);
create index if not exists idx_decision_reverts_record on decision_reverts(record_type, record_id);

alter table decision_reverts enable row level security;
alter table decision_reverts force row level security;

-- Readable within the company, same as hr_activity_log. No insert / update /
-- delete policy: rows only come from the functions below, and can't be edited.
drop policy if exists decision_reverts_select on decision_reverts;
create policy decision_reverts_select on decision_reverts
  for select using (company_id = auth_company_id() or is_superadmin());

alter table employee_requests add column if not exists original_onsite_arrived_at timestamptz;
alter table employee_requests add column if not exists original_onsite_done_at timestamptz;
alter table employee_requests add column if not exists original_onsite_saved_at timestamptz;

create or replace function decision_revert_caller()
returns table(company_id uuid, profile_id uuid, name text, is_super boolean)
language sql stable security definer set search_path = public as $$
  select
    p.company_id,
    p.id,
    coalesce(p.display_name, p.username, p.email),
    exists (select 1 from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) r where upper(r) in ('SUPERADMIN', 'SUPERSUPERADMIN'))
  from profiles p
  where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    and coalesce(p.is_active, true)
  limit 1;
$$;

-- Returns the request's status afterwards: it can stay Approved if two other
-- steps still approve it, or stay Rejected if another step rejected it.
create or replace function revert_pto_stage(p_id uuid, p_stage text, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
  v_request pto_requests%rowtype;
  v_status text;
  v_decided_by uuid;
  v_previous_note text;
  v_stage_label text;
  v_line text;
  v_review_note text;
  v_after text;
begin
  select * into v_caller from decision_revert_caller();
  if v_caller.profile_id is null then
    raise exception 'Profile not found';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'A note is required to revert a decision.';
  end if;
  if p_stage not in ('manager', 'hr', 'accounting') then
    raise exception 'Unknown step';
  end if;

  select * into v_request from pto_requests r where r.id = p_id and r.company_id = v_caller.company_id for update;
  if not found then
    raise exception 'That request could not be found.';
  end if;
  if v_request.status = 'cancelled' then
    raise exception 'That request was cancelled, so there is nothing to revert.';
  end if;

  if p_stage = 'manager' then
    v_status := v_request.manager_status; v_decided_by := v_request.manager_reviewed_by; v_previous_note := v_request.manager_note; v_stage_label := 'Manager';
  elsif p_stage = 'hr' then
    v_status := v_request.hr_status; v_decided_by := v_request.hr_reviewed_by; v_previous_note := v_request.hr_note; v_stage_label := 'HR';
  else
    v_status := v_request.accounting_status; v_decided_by := v_request.accounting_reviewed_by; v_previous_note := v_request.accounting_note; v_stage_label := 'Accounting';
  end if;

  if v_status not in ('approved', 'rejected') then
    raise exception 'That step has no decision to revert.';
  end if;
  if not v_caller.is_super and v_decided_by is distinct from v_caller.profile_id then
    raise exception 'Only the person who made this decision, or a Super Admin, can revert it.';
  end if;

  v_line := v_stage_label || case when v_status = 'approved' then ' approval' else ' rejection' end
    || ' reverted by ' || v_caller.name || '. Reason: ' || btrim(p_note);
  v_review_note := case when coalesce(v_request.review_note, '') = '' then v_line else v_request.review_note || E'\n' || v_line end;

  if p_stage = 'manager' then
    update pto_requests r
    set manager_status = 'pending', manager_reviewed_by = null, manager_reviewed_at = null, manager_note = null,
        manager_comments = null, manager_signature_url = null, manager_signature_name = null, manager_signed_at = null,
        review_note = v_review_note
    where r.id = p_id
    returning r.status into v_after;
  elsif p_stage = 'hr' then
    update pto_requests r
    set hr_status = 'pending', hr_reviewed_by = null, hr_reviewed_at = null, hr_note = null, review_note = v_review_note
    where r.id = p_id
    returning r.status into v_after;
  else
    update pto_requests r
    set accounting_status = 'pending', accounting_reviewed_by = null, accounting_reviewed_at = null, accounting_note = null,
        accounting_signature_url = null, accounting_signature_name = null, accounting_signed_at = null,
        review_note = v_review_note
    where r.id = p_id
    returning r.status into v_after;
  end if;

  insert into decision_reverts (
    company_id, record_type, record_id, stage, subject_profile_id, subject_name, label,
    previous_status, previous_decided_by, previous_decided_by_name, previous_note,
    reverted_by, reverted_by_name, note, details
  ) values (
    v_request.company_id, 'pto_request', p_id, p_stage, v_request.profile_id,
    (select coalesce(s.display_name, s.username, s.email) from profiles s where s.id = v_request.profile_id),
    initcap(v_request.pto_type::text) || ' ' || v_request.start_date::text
      || case when v_request.end_date <> v_request.start_date then ' to ' || v_request.end_date::text else '' end,
    v_status, v_decided_by,
    (select coalesce(d.display_name, d.username, d.email) from profiles d where d.id = v_decided_by),
    v_previous_note, v_caller.profile_id, v_caller.name, btrim(p_note),
    jsonb_build_object('status_before', v_request.status, 'status_after', v_after)
  );

  return v_after;
end;
$$;

-- Returns { ticket_no, was_approved, times_restored }.
create or replace function revert_ticket_dispute(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
  v_request employee_requests%rowtype;
  v_restored boolean := false;
  v_line text;
begin
  select * into v_caller from decision_revert_caller();
  if v_caller.profile_id is null then
    raise exception 'Profile not found';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'A note is required to revert a decision.';
  end if;

  select * into v_request from employee_requests r
  where r.id = p_id and r.company_id = v_caller.company_id and r.request_type = 'ticket_time_dispute'
  for update;
  if not found then
    raise exception 'That dispute could not be found.';
  end if;
  if v_request.status not in ('approved', 'rejected') then
    raise exception 'That dispute has no decision to revert.';
  end if;
  if not v_caller.is_super and v_request.reviewed_by is distinct from v_caller.profile_id then
    raise exception 'Only the person who made this decision, or a Super Admin, can revert it.';
  end if;

  if v_request.status = 'approved' and v_request.original_onsite_saved_at is not null and v_request.ticket_no is not null then
    update tickets t
    set onsite_arrived_at = v_request.original_onsite_arrived_at, onsite_done_at = v_request.original_onsite_done_at
    where t.company_id = v_request.company_id and t.ticket_no = v_request.ticket_no;
    v_restored := found;
  end if;

  v_line := case when v_request.status = 'approved' then 'Approval' else 'Rejection' end
    || ' reverted by ' || v_caller.name || '. Reason: ' || btrim(p_note);

  update employee_requests r
  set status = 'pending', reviewed_by = null, reviewed_at = null, review_note = v_line,
      manager_comments = null, manager_signature_url = null, manager_signature_name = null, manager_signed_at = null,
      original_onsite_arrived_at = null, original_onsite_done_at = null, original_onsite_saved_at = null
  where r.id = p_id;

  insert into decision_reverts (
    company_id, record_type, record_id, subject_profile_id, subject_name, label,
    previous_status, previous_decided_by, previous_decided_by_name, previous_note,
    reverted_by, reverted_by_name, note, details
  ) values (
    v_request.company_id, 'ticket_time_dispute', p_id, v_request.profile_id,
    (select coalesce(s.display_name, s.username, s.email) from profiles s where s.id = v_request.profile_id),
    case when v_request.ticket_no is not null then 'Ticket ' || v_request.ticket_no else 'Ticket dispute' end,
    v_request.status, v_request.reviewed_by,
    (select coalesce(d.display_name, d.username, d.email) from profiles d where d.id = v_request.reviewed_by),
    v_request.review_note, v_caller.profile_id, v_caller.name, btrim(p_note),
    jsonb_build_object('ticket_no', v_request.ticket_no, 'times_restored', v_restored)
  );

  return jsonb_build_object('ticket_no', v_request.ticket_no, 'was_approved', v_request.status = 'approved', 'times_restored', v_restored);
end;
$$;

notify pgrst, 'reload schema';
