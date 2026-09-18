-- =====================================================================
-- 0271 — CSR Daily Report: Extension call-volume table, the Extension
-- legend, and the daily summary panel (CSRTeamDailyReport.tsx).
--
-- csr_extensions             company-wide roster of extension codes (e.g.
--                             "EXT 0") + what each one means ("Repeat
--                             Options") — persisted once, not re-typed
--                             daily. Same list backs both the AM/PM call
--                             table and the Information legend.
-- csr_extension_daily_counts one row per (extension, day) — the AM/PM call
--                             counts, typed in by hand each day.
-- csr_daily_report_totals    one row per (company, day) — the handful of
--                             summary numbers that don't come from
--                             anywhere else in the app (Inbound/Outbound/
--                             Update CSR Calls, Mistakes, HU, MC), typed
--                             in by hand. The rest of the summary panel
--                             (Total CSR, Handle TK, Schedule, Attempt,
--                             Update, GH) is computed client-side as a sum
--                             of the main grid's own columns for that day
--                             — never stored, always accurate.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as csr_teams (0031) and csr_daily_report_entries
-- (0270).
-- Run once in the Supabase SQL Editor, after 0270.
-- =====================================================================

create table if not exists csr_extensions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  code        text not null,
  label       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_csr_extensions_company on csr_extensions(company_id);

create table if not exists csr_extension_daily_counts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  extension_id  uuid not null references csr_extensions(id) on delete cascade,
  report_date   date not null,
  am_count      numeric,
  pm_count      numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (extension_id, report_date)
);
create index if not exists idx_csr_extension_daily_counts_company on csr_extension_daily_counts(company_id);
create index if not exists idx_csr_extension_daily_counts_date on csr_extension_daily_counts(report_date);

create table if not exists csr_daily_report_totals (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  report_date       date not null,
  inbound_calls     numeric,
  outbound_calls    numeric,
  update_csr_calls  numeric,
  mistakes          numeric,
  hu                numeric,
  mc                numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, report_date)
);
create index if not exists idx_csr_daily_report_totals_date on csr_daily_report_totals(report_date);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function csr_daily_report_extras_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_csr_extensions_stamp on csr_extensions;
create trigger trg_csr_extensions_stamp before insert or update on csr_extensions
  for each row execute function csr_daily_report_extras_stamp();

drop trigger if exists trg_csr_extension_daily_counts_stamp on csr_extension_daily_counts;
create trigger trg_csr_extension_daily_counts_stamp before insert or update on csr_extension_daily_counts
  for each row execute function csr_daily_report_extras_stamp();

drop trigger if exists trg_csr_daily_report_totals_stamp on csr_daily_report_totals;
create trigger trg_csr_daily_report_totals_stamp before insert or update on csr_daily_report_totals
  for each row execute function csr_daily_report_extras_stamp();

-- ---------- RLS: company-scoped, same pattern as csr_teams (0031) ----------
do $$
declare t text;
begin
  foreach t in array array['csr_extensions', 'csr_extension_daily_counts', 'csr_daily_report_totals'] loop
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

    execute format('drop policy if exists %1$s_update on %1$I;', t);
    execute format($f$
      create policy %1$s_update on %1$I
      for update using (company_id = auth_company_id() or is_superadmin())
                  with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_delete on %1$I;', t);
    execute format($f$
      create policy %1$s_delete on %1$I
      for delete using (company_id = auth_company_id() or is_superadmin());
    $f$, t);
  end loop;
end $$;
