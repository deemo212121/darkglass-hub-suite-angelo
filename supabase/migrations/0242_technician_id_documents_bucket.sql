-- Private bucket for the two new photo uploads on the Master W-2 Technician
-- Agreement (driver's license + Social Security card) — same
-- private-bucket + company-scoped RLS convention as candidate-cvs
-- (0042_hr_candidates.sql) and pto-attachments (0240_pto_requests_attachment.sql).
-- Deliberately no typed SSN field anywhere in the app — a photo of the card
-- is the only way this is captured, so there's never a plaintext SSN
-- sitting in a database column.

insert into storage.buckets (id, name, public)
values ('technician-id-documents', 'technician-id-documents', false)
on conflict (id) do nothing;

drop policy if exists technician_id_documents_select on storage.objects;
create policy technician_id_documents_select on storage.objects
  for select using (
    bucket_id = 'technician-id-documents'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );

drop policy if exists technician_id_documents_insert on storage.objects;
create policy technician_id_documents_insert on storage.objects
  for insert with check (
    bucket_id = 'technician-id-documents'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );

drop policy if exists technician_id_documents_delete on storage.objects;
create policy technician_id_documents_delete on storage.objects
  for delete using (
    bucket_id = 'technician-id-documents'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );
