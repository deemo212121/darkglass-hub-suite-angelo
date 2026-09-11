-- Re-applies the "pto-attachments" bucket + its 3 storage.objects policies
-- from scratch (0240_pto_requests_attachment.sql) — a fresh HR Status
-- attachment upload from Absent List is failing with "new row violates
-- row-level security policy" on POST .../storage/v1/object/pto-attachments,
-- even though 0240 was reportedly already run. Fully idempotent: safe to
-- run even if 0240 already applied cleanly — this just guarantees the end
-- state rather than assuming it, in case that run silently missed a
-- statement (e.g. a partial failure in the Supabase SQL Editor).

insert into storage.buckets (id, name, public)
values ('pto-attachments', 'pto-attachments', false)
on conflict (id) do update set public = false;

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

drop policy if exists pto_attachments_update on storage.objects;
create policy pto_attachments_update on storage.objects
  for update using (
    bucket_id = 'pto-attachments'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  ) with check (
    bucket_id = 'pto-attachments'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );

drop policy if exists pto_attachments_delete on storage.objects;
create policy pto_attachments_delete on storage.objects
  for delete using (
    bucket_id = 'pto-attachments'
    and ((storage.foldername(name))[1] = (auth_company_id())::text or is_superadmin())
  );
