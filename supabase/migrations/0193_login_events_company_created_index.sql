-- The "shared IP" login-anomaly check (supabaseTokenBridge.ts's
-- detectAndNotifyLoginFlags) reads the 500 most recent login_events for a
-- company via `company_id=eq.X&order=created_at.desc&limit=500`. The
-- existing login_events_company_id_idx only covers company_id, so Postgres
-- filters via that index and then sorts the matching rows separately. A
-- composite index lets it satisfy both the filter and the ordering from the
-- index directly, avoiding that sort as the table grows.
create index if not exists login_events_company_id_created_at_idx
  on login_events (company_id, created_at desc);
