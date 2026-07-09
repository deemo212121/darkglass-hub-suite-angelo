-- =====================================================================
-- 0041 — CSR Agent Notes: approval workflow
--
-- Ported from upstream (janeyyy16/usapp)'s 0029_csr_agent_notes_review.sql,
-- renumbered to 0041 (see 0040_csr_agent_notes.sql for why).
--
-- A Team Leader submitting a warning/mistake no longer immediately counts
-- against the agent — it's queued as 'pending' until a CSR Manager
-- approves or rejects it. Only 'approved' notes are meant to be surfaced
-- as the agent's official record; 'pending'/'rejected' still show (with
-- their status) to whoever can already see the notes list, but don't
-- count toward the agent's Warnings/Mistakes totals.
--
-- Run once in the Supabase SQL Editor, after 0040_csr_agent_notes.sql.
-- =====================================================================

alter table csr_agent_notes
  add column if not exists status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  add column if not exists reviewed_by uuid references profiles(id),
  add column if not exists reviewed_at timestamptz;

create index if not exists idx_csr_agent_notes_status on csr_agent_notes(company_id, status);

-- Auto-stamp reviewed_by/reviewed_at the moment status leaves 'pending'.
create or replace function csr_agent_notes_stamp_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    new.reviewed_by := auth_profile_id();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_csr_agent_notes_review on csr_agent_notes;
create trigger trg_csr_agent_notes_review before update on csr_agent_notes
  for each row execute function csr_agent_notes_stamp_review();

-- 0028 only granted select/insert/delete — add update so a manager can
-- change status.
drop policy if exists csr_agent_notes_update on csr_agent_notes;
create policy csr_agent_notes_update on csr_agent_notes
  for update using (company_id = auth_company_id() or is_superadmin())
             with check (company_id = auth_company_id() or is_superadmin());
