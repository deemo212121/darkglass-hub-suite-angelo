-- Exploded View / Service Bulletin on the ticket detail's Product Information
-- section were each a single URL (model_resources, migration 0019). HR/Tech
-- wants to attach more than one link per field (e.g. multiple bulletins for
-- the same model), plus a brand-new third field, "Tech Data Sheet", that
-- also needs multi-link support.
--
-- Converts both existing single-URL columns to text[] (preserving any
-- existing link as a 1-element array) and adds tech_data_sheet_urls as a
-- new text[] column. No junction table needed — this is still one row per
-- (company_id, model), just with array-typed link columns instead of
-- per-link metadata.
--
-- Run once in the Supabase SQL Editor, after 0310.

alter table model_resources
  add column if not exists exploded_view_urls text[] not null default '{}',
  add column if not exists service_bulletin_urls text[] not null default '{}',
  add column if not exists tech_data_sheet_urls text[] not null default '{}';

update model_resources
  set exploded_view_urls = array[exploded_view_url]
  where exploded_view_url is not null and exploded_view_url <> '' and exploded_view_urls = '{}';

update model_resources
  set service_bulletin_urls = array[service_bulletin_url]
  where service_bulletin_url is not null and service_bulletin_url <> '' and service_bulletin_urls = '{}';

alter table model_resources drop column if exists exploded_view_url;
alter table model_resources drop column if exists service_bulletin_url;
