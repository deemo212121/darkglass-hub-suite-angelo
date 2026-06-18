-- =====================================================================
-- 0010 — Ticket Comments (shared Servicer Notes thread)
-- A single conversation thread per ticket so technicians (mobile) and CSRs
-- (web ticket detail › General Information › Servicer Notes) communicate on
-- the same ticket. Company-scoped via RLS like every tenant table.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists ticket_comments (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null,
  body            text not null,
  author_name     text,
  author_role     text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  constraint comments_ticket_same_company
    foreign key (ticket_id, company_id) references tickets(id, company_id) on delete cascade
);
create index if not exists idx_ticket_comments_ticket on ticket_comments(ticket_id, created_at);

alter table ticket_comments enable row level security;
alter table ticket_comments force row level security;

drop policy if exists ticket_comments_select on ticket_comments;
create policy ticket_comments_select on ticket_comments
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_comments_insert on ticket_comments;
create policy ticket_comments_insert on ticket_comments
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_comments_update on ticket_comments;
create policy ticket_comments_update on ticket_comments
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_comments_delete on ticket_comments;
create policy ticket_comments_delete on ticket_comments
  for delete using (company_id = auth_company_id() or is_superadmin());

drop trigger if exists trg_ticket_comments_company on ticket_comments;
create trigger trg_ticket_comments_company
  before insert on ticket_comments
  for each row execute function set_company_id();
