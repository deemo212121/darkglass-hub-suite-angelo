-- =====================================================================
-- 0040 — CSR Agent Notes (warnings / mistakes)
--
-- Ported from upstream (janeyyy16/usapp)'s 0028_csr_agent_notes.sql —
-- renumbered to 0040 here since this project's own migration sequence
-- had already used 0028-0039 for unrelated features (timecard
-- corrections, notifications, PTO two-stage approval, realtime,
-- truck stock status, etc.) by the time this one was pulled in.
--
-- Lets a Team Leader (or Manager) attach a warning or mistake note to a
-- CSR Agent from that agent's detail page, optionally referencing a
-- ticket number. Append-only audit trail — no update, only insert/select/
-- delete (delete lets a leader retract a note entered in error).
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session, same pattern as csr_teams (0027).
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists csr_agent_notes (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  agent_profile_id  uuid not null references profiles(id) on delete cascade,
  type              text not null check (type in ('warning', 'mistake')),
  ticket_no         text,
  note              text not null,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now()
);
create index if not exists idx_csr_agent_notes_company on csr_agent_notes(company_id);
create index if not exists idx_csr_agent_notes_agent on csr_agent_notes(agent_profile_id, created_at desc);

-- ---------- Auto-stamp company_id from the caller's session ----------
create or replace function csr_agent_notes_stamp_company()
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

drop trigger if exists trg_csr_agent_notes_stamp on csr_agent_notes;
create trigger trg_csr_agent_notes_stamp before insert on csr_agent_notes
  for each row execute function csr_agent_notes_stamp_company();

-- ---------- RLS: company-scoped, same pattern as the rest of the platform ----------
do $$
declare t text;
begin
  foreach t in array array['csr_agent_notes'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);

    execute format('drop policy if exists %1$s_select on %1$I;', t);
    execute format($f$
      create policy %1$s_select on %1$I
      for select using (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_insert on %1$I;', t);
    execute format($f$
      create policy %1$s_insert on %1$I
      for insert with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_delete on %1$I;', t);
    execute format($f$
      create policy %1$s_delete on %1$I
      for delete using (company_id = auth_company_id() or is_superadmin());
    $f$, t);
  end loop;
end $$;
