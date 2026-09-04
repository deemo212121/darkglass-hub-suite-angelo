-- =====================================================================
-- 0212 — "Internal Announcement" flag for messages
--
-- Company Announcements' Post Announcement panel gets a "Send as Internal
-- Announcement" checkbox — a plain per-message tag (shown as a badge on
-- the feed), distinct from is_announcement (which marks a message as an
-- announcement at all, channel-level convention already in place).
--
-- Run once in the Supabase SQL Editor, after 0211.
-- =====================================================================

alter table messages
  add column if not exists is_internal boolean not null default false;
