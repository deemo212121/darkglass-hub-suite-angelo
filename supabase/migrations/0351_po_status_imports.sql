-- Item progress is independent of legacy invoice status.
alter table public.part_orders add column if not exists progress_status text
  check (progress_status in ('Pending', 'In progress', 'Completed'));

-- Standalone provider lines: no ticket foreign key or ticket writes.
create table if not exists public.po_status_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_key text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique(company_id, source_key)
);
alter table public.po_status_imports enable row level security;
drop policy if exists po_status_imports_select on public.po_status_imports;
create policy po_status_imports_select on public.po_status_imports
  for select using (company_id = public.auth_company_id());
grant select on public.po_status_imports to authenticated;
