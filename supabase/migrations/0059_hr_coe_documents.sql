-- =====================================================================
-- 0059 — Certificate of Employment sent-history
--
-- Every COE sent via "Preview & Send" gets a row here (the real generated
-- PDF's Firebase Storage URL, who it went to, who sent it, when) so the
-- Generate COE tab can show a "COE Sent History" list — mirrors the
-- existing Sent Warning Forms tracking table's shape, minus the signature
-- workflow (a COE is just sent, not signed).
--
-- Run once in the Supabase SQL Editor, after 0058.
-- =====================================================================

create table if not exists hr_coe_documents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_name   text not null,
  document_url    text not null,
  document_path   text,
  recipient_id    uuid references profiles(id),
  sent_by         uuid references profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_hr_coe_documents_company on hr_coe_documents(company_id, created_at desc);

create or replace function hr_coe_documents_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.sent_by is null then
    new.sent_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_coe_documents_stamp on hr_coe_documents;
create trigger trg_hr_coe_documents_stamp before insert on hr_coe_documents
  for each row execute function hr_coe_documents_stamp();

-- ---------- RLS ----------
alter table hr_coe_documents enable row level security;
alter table hr_coe_documents force row level security;

drop policy if exists hr_coe_documents_select on hr_coe_documents;
create policy hr_coe_documents_select on hr_coe_documents
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_coe_documents_insert on hr_coe_documents;
create policy hr_coe_documents_insert on hr_coe_documents
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_coe_documents_delete on hr_coe_documents;
create policy hr_coe_documents_delete on hr_coe_documents
  for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- Realtime ----------
do $$
begin
  alter publication supabase_realtime add table hr_coe_documents;
exception when duplicate_object then
  raise notice 'hr_coe_documents already in supabase_realtime publication';
end $$;
