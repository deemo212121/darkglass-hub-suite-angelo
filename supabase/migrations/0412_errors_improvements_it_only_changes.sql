-- =====================================================================
-- 0412 — Admin → Errors & Improvements: anyone can add, only IT changes,
-- and an item is deleted by whoever added it or a SuperAdmin.
--
-- Everyone who can open the page (Admin / SuperAdmin of the company, as
-- 0409) still reads the list and adds to it. Only IT (main or extra role)
-- confirms / undoes, edits and assigns (0411's trigger already holds that
-- one); an item is deleted by whoever added it, or by a SuperAdmin:
--   * update: IT of the company only;
--   * delete: the item's own added_by, or SuperAdmin (main or extra role)
--     of the company;
--   * insert: unchanged, except a new item can't arrive already confirmed
--     unless IT adds it.
-- Adds is_it(), the same shape as is_admin() (0089).
--
-- Policies and one function only — no data changes. Safe to run again.
-- Run once in the Supabase SQL Editor (Run without RLS), after 0411.
-- =====================================================================

create or replace function is_it()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'
      and (role = 'IT' or 'IT' = any(extra_roles))
  );
$$;

drop policy if exists admin_errors_improvements_insert on admin_errors_improvements;
create policy admin_errors_improvements_insert on admin_errors_improvements
  for insert with check (
    company_id = auth_company_id()
    and (is_admin() or is_company_superadmin())
    and (confirmed_at is null or is_it())
  );

drop policy if exists admin_errors_improvements_update on admin_errors_improvements;
create policy admin_errors_improvements_update on admin_errors_improvements
  for update using (company_id = auth_company_id() and is_it())
              with check (company_id = auth_company_id() and is_it());

drop policy if exists admin_errors_improvements_delete on admin_errors_improvements;
create policy admin_errors_improvements_delete on admin_errors_improvements
  for delete using (
    company_id = auth_company_id()
    and (added_by = auth_profile_id() or is_company_superadmin())
  );
