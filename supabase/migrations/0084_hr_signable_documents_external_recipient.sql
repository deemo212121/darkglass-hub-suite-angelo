-- =====================================================================
-- 0084 — External (no-login) recipients for signable HR documents
--
-- Until now every signable document (Employee Warning Form, W-8BEN/W-4/W-9)
-- required recipient_id: a real AHS profile, and signing required being
-- logged into AHS as that exact profile (see SignDocumentPage.tsx's
-- isRecipient check). That's still the default flow. This adds a SECOND,
-- additional path: HR can instead type a free-text recipient_name with no
-- linked profile at all, generating a link anyone can open and sign
-- without an AHS account — see src/lib/server/signableDocumentsBridge.ts,
-- which only ever serves/accepts documents where recipient_id IS NULL, so
-- this can never become a backdoor into an internal (recipient_id-based)
-- document's normal login-gated flow.
--
-- Run once in the Supabase SQL Editor, after 0083.
-- =====================================================================

alter table hr_signable_documents alter column recipient_id drop not null;
alter table hr_signable_documents add column if not exists recipient_name text;

alter table hr_signable_documents drop constraint if exists hr_signable_documents_recipient_check;
alter table hr_signable_documents add constraint hr_signable_documents_recipient_check
  check (recipient_id is not null or recipient_name is not null);
