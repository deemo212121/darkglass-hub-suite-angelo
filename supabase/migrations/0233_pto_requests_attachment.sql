-- Photo attachment on a time-off request (e.g. a doctor's note for a sick
-- day) — settable when creating/editing a request from the Time Off
-- Calendar (HrCalendarTab.tsx). Same private-bucket + company-scoped RLS
-- convention as candidate-cvs (0042_hr_candidates.sql).

alter table pto_requests add column if not exists attachment_path text;

insert into storage.buckets (id, name, public)
values ('pto-attachments', 'pto-attachments', false)
on conflict (id) do nothing;

drop policy if exists pto_attachments_select on storage.objects;
create policy pto_attachments_select on storage.objects
  for select using (
    bucket_id = 'pto-attachments'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );

drop policy if exists pto_attachments_insert on storage.objects;
create policy pto_attachments_insert on storage.objects
  for insert with check (
    bucket_id = 'pto-attachments'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );

drop policy if exists pto_attachments_delete on storage.objects;
create policy pto_attachments_delete on storage.objects
  for delete using (
    bucket_id = 'pto-attachments'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );
