-- =====================================================================
-- 0443 — Accounting Dashboard → "New Promotion / New wage": Adjusted mark.
--
-- The list shows HR's Employee Promotion / Role Change forms and Promotion
-- Paper and Wage Increase letters (hr_signable_documents, document_type
-- 'promotion_form' / 'compensation_update'). Once Accounting has changed
-- the employee's rate in Payroll, they press Adjusted on that row; this
-- table remembers it (one row per document) so everyone in Accounting sees
-- it, with who pressed it and when. Pressing Undo removes the row.
--
-- Access:
--   read          : everyone in the same company
--   mark / undo   : Finance (Accounting), Admin, Super Admin — only through
--                   set_wage_adjusted(), which stamps who and when itself.
--
-- New table and function only — HR's documents are not changed.
-- Safe to run again. Run once in the Supabase SQL Editor, after 0442.
-- =====================================================================

create table if not exists accounting_wage_adjustments (
  document_id       uuid primary key references hr_signable_documents(id) on delete cascade,
  company_id        uuid not null references companies(id) on delete cascade,
  adjusted_by       uuid references profiles(id) on delete set null,
  adjusted_by_name  text,
  adjusted_at       timestamptz not null default now()
);

create index if not exists idx_accounting_wage_adjustments_company on accounting_wage_adjustments(company_id);

alter table accounting_wage_adjustments enable row level security;

drop policy if exists accounting_wage_adjustments_select on accounting_wage_adjustments;
create policy accounting_wage_adjustments_select on accounting_wage_adjustments
  for select using (company_id = auth_company_id());
-- No insert / update / delete policies: changes go through set_wage_adjusted() only.

create or replace function set_wage_adjusted(p_document_id uuid, p_adjusted boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_type text;
begin
  if not (is_finance() or is_admin() or is_company_superadmin() or is_superadmin()) then
    raise exception 'Only Accounting, Admin or Super Admin can mark a wage as adjusted.';
  end if;

  select company_id, document_type into v_company, v_type
    from hr_signable_documents where id = p_document_id;
  if v_company is null or v_company <> auth_company_id() then
    raise exception 'Document not found.';
  end if;
  if v_type not in ('promotion_form', 'compensation_update') then
    raise exception 'Only promotion forms and wage-increase letters can be marked adjusted.';
  end if;

  if p_adjusted then
    insert into accounting_wage_adjustments (document_id, company_id, adjusted_by, adjusted_by_name, adjusted_at)
    values (
      p_document_id, v_company, auth_profile_id(),
      (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id()),
      now()
    )
    on conflict (document_id) do update
      set adjusted_by = excluded.adjusted_by, adjusted_by_name = excluded.adjusted_by_name, adjusted_at = excluded.adjusted_at;
  else
    delete from accounting_wage_adjustments where document_id = p_document_id;
  end if;
end;
$$;

grant execute on function set_wage_adjusted(uuid, boolean) to authenticated;
