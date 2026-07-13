-- =====================================================================
-- 0050 — Signable HR Documents (Employee Warning Form e-signature loop)
--
-- Supports: HR generates a document (currently just 'warning_form'),
-- sends it to one recipient to sign, the recipient draws a signature
-- in-app, and the document is re-flattened into a PDF and sent back to
-- HR automatically. `form_data` snapshots everything needed to
-- regenerate the document's HTML (including a frozen copy of "previous
-- warnings" as of generation time, so a later new warning doesn't
-- retroactively change a document already out for signature).
--
-- `signatures` accumulates one entry per slot as they're captured —
-- structured as a jsonb object so a document can route through more than
-- one signer over its lifetime (see "Send to Next Recipient" below)
-- without a schema change:
--   { "manager": { "name": "...", "url": "...", "signedAt": "..." } }
--
-- Status lifecycle:
--   pending_signature -> signed -> confirmed   (normal path)
--                      -> cancelled             (HR aborts, any time before confirmed)
-- The warning is only actually logged into employee_conduct_notes at
-- 'confirmed' (HR's explicit "Confirm Warning" action after reviewing the
-- signed-back document) — sending/signing alone does not yet count against
-- the employee's record. `agent_note_id` links back to that note once
-- created, so a (pre-confirm) cancellation has something concrete to
-- retract if one ever existed.
--
-- "Send to Next Recipient" reassigns recipient_id/recipient_slot on the
-- SAME row and resets status back to pending_signature — previously
-- captured signatures stay put in the `signatures` jsonb, so a document
-- can pick up multiple signers over several rounds without losing earlier
-- ones.
--
-- Run once in the Supabase SQL Editor, after 0049.
-- =====================================================================

create table if not exists hr_signable_documents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  document_type   text not null default 'warning_form',
  form_data       jsonb not null,
  signatures      jsonb not null default '{}'::jsonb,
  status          text not null default 'pending_signature' check (status in ('pending_signature', 'signed', 'confirmed', 'cancelled')),
  recipient_id    uuid not null references profiles(id),
  recipient_slot  text not null check (recipient_slot in ('employee', 'manager', 'senior_manager', 'hr_staff')),
  pdf_url         text,
  agent_note_id   uuid references employee_conduct_notes(id) on delete set null,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  signed_at       timestamptz,
  confirmed_at    timestamptz,
  cancelled_at    timestamptz
);
create index if not exists idx_hr_signable_documents_recipient on hr_signable_documents(recipient_id, status);
create index if not exists idx_hr_signable_documents_company on hr_signable_documents(company_id);

-- Additive columns/constraint widening for anyone who already ran an
-- earlier version of this migration (pre-confirm/cancel workflow).
alter table hr_signable_documents add column if not exists agent_note_id uuid references employee_conduct_notes(id) on delete set null;
alter table hr_signable_documents add column if not exists confirmed_at timestamptz;
alter table hr_signable_documents add column if not exists cancelled_at timestamptz;
alter table hr_signable_documents drop constraint if exists hr_signable_documents_status_check;
alter table hr_signable_documents add constraint hr_signable_documents_status_check
  check (status in ('pending_signature', 'signed', 'confirmed', 'cancelled'));

create or replace function hr_signable_documents_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.created_by is null then
    new.created_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_signable_documents_stamp on hr_signable_documents;
create trigger trg_hr_signable_documents_stamp before insert on hr_signable_documents
  for each row execute function hr_signable_documents_stamp();

-- ---------- RLS ----------
-- Select: anyone in the company (so HR can see everything they/others
-- sent). Update: the current recipient (to sign) OR the original creator
-- (to reassign/confirm/cancel) OR superadmin.
alter table hr_signable_documents enable row level security;
alter table hr_signable_documents force row level security;

drop policy if exists hr_signable_documents_select on hr_signable_documents;
create policy hr_signable_documents_select on hr_signable_documents
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_signable_documents_insert on hr_signable_documents;
create policy hr_signable_documents_insert on hr_signable_documents
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_signable_documents_update on hr_signable_documents;
create policy hr_signable_documents_update on hr_signable_documents
  for update using (recipient_id = auth_profile_id() or created_by = auth_profile_id() or is_superadmin())
              with check (recipient_id = auth_profile_id() or created_by = auth_profile_id() or is_superadmin());

drop policy if exists hr_signable_documents_delete on hr_signable_documents;
create policy hr_signable_documents_delete on hr_signable_documents
  for delete using (company_id = auth_company_id() or is_superadmin());
