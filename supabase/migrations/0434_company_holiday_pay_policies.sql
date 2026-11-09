-- Explicit holiday pay policies. NULL means HR has not configured the policy.
-- Existing holidays keep their current payroll behavior until configured.
begin;
alter table public.company_holidays
  add column if not exists hourly_paid boolean,
  add column if not exists fixed_salary_paid boolean;
comment on column public.company_holidays.hourly_paid is 'Paid scheduled holiday for hourly employees; NULL = not configured.';
comment on column public.company_holidays.fixed_salary_paid is 'Paid-day salary credit for fixed-salary employees; NULL = not configured.';
notify pgrst, 'reload schema';
commit;
