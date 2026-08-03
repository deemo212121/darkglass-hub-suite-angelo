-- =====================================================================
-- 0100_platform_admin_data_lockdown.sql
--
-- SUPERSUPERADMIN (the platform-level role) used to bypass RLS on every
-- company-scoped table via `is_superadmin()` being OR'd into ~106 policies
-- across ~61 tables. That bypass is now removed everywhere EXCEPT
-- `companies` and `profiles` — the platform role's job is overseeing which
-- companies exist and how many/which accounts they have, never a company's
-- actual operational data (tickets, timecards, HR docs, parts, claims,
-- chat, anything else). `companies_*`/`profiles_*` policies (0001_init.sql)
-- are untouched by this migration.
--
-- Two non-policy PL/pgSQL bypasses are tightened the same way: the
-- hr_update_candidate_status() RPC's manual is_superadmin() exemption, and
-- set_company_id()'s now-pointless is_superadmin() early-return (verified
-- safe — profiles uses a separate trigger, stamp_profile_company(), that
-- was never touched by set_company_id() in the first place).
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

-- ---------- 1. Uniform-shape tables (60) — same loop technique as 0001_init.sql ----------
-- Every one of these currently has `<table>_select/insert/update/delete`
-- policies of the exact shape `using/with check (company_id = auth_company_id()
-- or is_superadmin())` (update: same on both clauses). Reusing the loop that
-- originally created them, just with the OR-clause dropped.
do $$
declare
  t text;
  business_tables text[] := array[
    -- 0001_init.sql's 42-table loop, minus 'messages' (handled separately below
    -- since its insert policy has an extra announcement-role clause)
    'user_settings','locations','location_addresses','employees','technician_locations',
    'service_accounts','salary_entries','hr_candidates','attendance_notes','employee_audit_log',
    'customers','tickets','visits','parts','ticket_alerts','ticket_audit_log','ticket_visit_log',
    'sms_messages','part_orders','part_pickups','part_collections','part_receipts','part_returns',
    'part_inventory','part_transactions','claims','claim_authorizations','timecard_entries',
    'pto_requests','payroll_runs','payroll_line_items','payroll_audit_log','expenses',
    'daily_activity_reports','csr_activity','call_logs','message_channels','dm_threads',
    'message_reads','channel_members','repair_statuses',
    -- 0003_location_management.sql's 3-table loop
    'location_mgmt_locations','location_mgmt_part_addresses','location_mgmt_coverage',
    -- 0031_csr_team_composition.sql's 2-table loop
    'csr_teams','csr_team_members',
    -- 0048_hr_hiring_reports.sql's 3-table loop
    'hr_staffing_targets','hr_candidate_status_history','hr_candidate_cv_forwards',
    -- Individual files, same standard shape
    'ticket_billing','ticket_comments','model_resources','truck_stock','timecard_corrections',
    'employee_requests','onboarding_documents','hr_jotform_submissions','hr_custom_forms',
    'hr_custom_form_submissions',
    -- Renamed by 0044 from csr_agent_notes -> employee_conduct_notes
    'employee_conduct_notes'
  ];
begin
  foreach t in array business_tables loop
    execute format('drop policy if exists %1$s_select on %1$I', t);
    execute format('create policy %1$s_select on %1$I for select using (company_id = auth_company_id())', t);

    execute format('drop policy if exists %1$s_insert on %1$I', t);
    execute format('create policy %1$s_insert on %1$I for insert with check (company_id = auth_company_id())', t);

    execute format('drop policy if exists %1$s_update on %1$I', t);
    execute format('create policy %1$s_update on %1$I for update using (company_id = auth_company_id()) with check (company_id = auth_company_id())', t);

    execute format('drop policy if exists %1$s_delete on %1$I', t);
    execute format('create policy %1$s_delete on %1$I for delete using (company_id = auth_company_id())', t);
  end loop;
end $$;

-- ---------- 2. Special-shape objects (individual statements) ----------

-- messages: select/update/delete are standard; insert also gates announcements.
drop policy if exists messages_select on messages;
create policy messages_select on messages for select using (company_id = auth_company_id());

drop policy if exists messages_insert on messages;
create policy messages_insert on messages
  for insert with check (
    company_id = auth_company_id()
    and (
      is_announcement = false
      or exists (
        select 1 from profiles p
        where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
          and p.role in ('SUPERADMIN','ADMIN','MANAGER','HR')
      )
    )
  );

drop policy if exists messages_update on messages;
create policy messages_update on messages for update using (company_id = auth_company_id()) with check (company_id = auth_company_id());

drop policy if exists messages_delete on messages;
create policy messages_delete on messages for delete using (company_id = auth_company_id());

-- notifications: recipient-scoped (not company-scoped) on select/update/delete.
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select using (recipient_id = auth_profile_id());

drop policy if exists notifications_insert on notifications;
create policy notifications_insert on notifications for insert with check (company_id = auth_company_id());

drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications for update using (recipient_id = auth_profile_id()) with check (recipient_id = auth_profile_id());

drop policy if exists notifications_delete on notifications;
create policy notifications_delete on notifications for delete using (recipient_id = auth_profile_id());

-- storage.objects, bucket 'candidate-cvs': folder-per-company scoping.
drop policy if exists candidate_cvs_select on storage.objects;
create policy candidate_cvs_select on storage.objects
  for select using (
    bucket_id = 'candidate-cvs' and (storage.foldername(name))[1] = (auth_company_id())::text
  );

drop policy if exists candidate_cvs_insert on storage.objects;
create policy candidate_cvs_insert on storage.objects
  for insert with check (
    bucket_id = 'candidate-cvs' and (storage.foldername(name))[1] = (auth_company_id())::text
  );

drop policy if exists candidate_cvs_delete on storage.objects;
create policy candidate_cvs_delete on storage.objects
  for delete using (
    bucket_id = 'candidate-cvs' and (storage.foldername(name))[1] = (auth_company_id())::text
  );

-- truck_stock_pull_requests: select/insert/update only, no delete policy exists.
drop policy if exists truck_stock_pull_requests_select on truck_stock_pull_requests;
create policy truck_stock_pull_requests_select on truck_stock_pull_requests for select using (company_id = auth_company_id());

drop policy if exists truck_stock_pull_requests_insert on truck_stock_pull_requests;
create policy truck_stock_pull_requests_insert on truck_stock_pull_requests for insert with check (company_id = auth_company_id());

drop policy if exists truck_stock_pull_requests_update on truck_stock_pull_requests;
create policy truck_stock_pull_requests_update on truck_stock_pull_requests for update using (company_id = auth_company_id()) with check (company_id = auth_company_id());

-- timecard_correction_history: immutable audit trail, select/insert only.
drop policy if exists timecard_correction_history_select on timecard_correction_history;
create policy timecard_correction_history_select on timecard_correction_history for select using (company_id = auth_company_id());

drop policy if exists timecard_correction_history_insert on timecard_correction_history;
create policy timecard_correction_history_insert on timecard_correction_history for insert with check (company_id = auth_company_id());

-- hr_signable_documents: select/insert/delete standard; update is owner-scoped.
drop policy if exists hr_signable_documents_select on hr_signable_documents;
create policy hr_signable_documents_select on hr_signable_documents for select using (company_id = auth_company_id());

drop policy if exists hr_signable_documents_insert on hr_signable_documents;
create policy hr_signable_documents_insert on hr_signable_documents for insert with check (company_id = auth_company_id());

drop policy if exists hr_signable_documents_update on hr_signable_documents;
create policy hr_signable_documents_update on hr_signable_documents
  for update using (recipient_id = auth_profile_id() or created_by = auth_profile_id())
  with check (recipient_id = auth_profile_id() or created_by = auth_profile_id());

drop policy if exists hr_signable_documents_delete on hr_signable_documents;
create policy hr_signable_documents_delete on hr_signable_documents for delete using (company_id = auth_company_id());

-- hr_activity_log: audit log, select/insert only.
drop policy if exists hr_activity_log_select on hr_activity_log;
create policy hr_activity_log_select on hr_activity_log for select using (company_id = auth_company_id());

drop policy if exists hr_activity_log_insert on hr_activity_log;
create policy hr_activity_log_insert on hr_activity_log for insert with check (company_id = auth_company_id());

-- hr_coe_documents: select/insert/delete only, no update.
drop policy if exists hr_coe_documents_select on hr_coe_documents;
create policy hr_coe_documents_select on hr_coe_documents for select using (company_id = auth_company_id());

drop policy if exists hr_coe_documents_insert on hr_coe_documents;
create policy hr_coe_documents_insert on hr_coe_documents for insert with check (company_id = auth_company_id());

drop policy if exists hr_coe_documents_delete on hr_coe_documents;
create policy hr_coe_documents_delete on hr_coe_documents for delete using (company_id = auth_company_id());

-- ticket_alert_dismissals: select/insert/delete only, no update.
drop policy if exists ticket_alert_dismissals_select on ticket_alert_dismissals;
create policy ticket_alert_dismissals_select on ticket_alert_dismissals for select using (company_id = auth_company_id());

drop policy if exists ticket_alert_dismissals_insert on ticket_alert_dismissals;
create policy ticket_alert_dismissals_insert on ticket_alert_dismissals for insert with check (company_id = auth_company_id());

drop policy if exists ticket_alert_dismissals_delete on ticket_alert_dismissals;
create policy ticket_alert_dismissals_delete on ticket_alert_dismissals for delete using (company_id = auth_company_id());

-- attendance_alerts: select-only (inserts are service-role, bypass RLS).
drop policy if exists attendance_alerts_select on attendance_alerts;
create policy attendance_alerts_select on attendance_alerts for select using (company_id = auth_company_id());

-- hr_onboarding_document_columns: select/insert/delete only, no update.
drop policy if exists hr_onboarding_document_columns_select on hr_onboarding_document_columns;
create policy hr_onboarding_document_columns_select on hr_onboarding_document_columns for select using (company_id = auth_company_id());

drop policy if exists hr_onboarding_document_columns_insert on hr_onboarding_document_columns;
create policy hr_onboarding_document_columns_insert on hr_onboarding_document_columns for insert with check (company_id = auth_company_id());

drop policy if exists hr_onboarding_document_columns_delete on hr_onboarding_document_columns;
create policy hr_onboarding_document_columns_delete on hr_onboarding_document_columns for delete using (company_id = auth_company_id());

-- login_events_select (0099's version): drop the trailing `or is_superadmin()`,
-- keep is_admin()/is_company_superadmin() company-scoped access as-is.
drop policy if exists login_events_select on login_events;
create policy login_events_select on login_events
  for select using (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));

-- live_chat_sessions: select (0093's version) had is_superadmin() as a
-- standalone top-level OR branch; update (0091) is standard shape.
drop policy if exists live_chat_sessions_select on live_chat_sessions;
create policy live_chat_sessions_select on live_chat_sessions
  for select using (
    company_id = auth_company_id()
    and (
      is_csr_wide_visibility()
      or assigned_to is null
      or assigned_to = auth_profile_id()
      or assigned_to in (select my_csr_team_member_ids())
    )
  );

drop policy if exists live_chat_sessions_update on live_chat_sessions;
create policy live_chat_sessions_update on live_chat_sessions
  for update using (company_id = auth_company_id()) with check (company_id = auth_company_id());

-- live_chat_messages: select/update already don't reference is_superadmin()
-- (0093/0094) — only insert's nested EXISTS subquery still does.
drop policy if exists live_chat_messages_insert on live_chat_messages;
create policy live_chat_messages_insert on live_chat_messages
  for insert with check (
    sender = 'staff' and exists (
      select 1 from live_chat_sessions s
      where s.id = live_chat_messages.session_id and s.company_id = auth_company_id()
    )
  );

-- ---------- 3. hr_update_candidate_status(): remove the cross-company exemption ----------
create or replace function hr_update_candidate_status(
  p_candidate_id uuid,
  p_new_status text,
  p_effective_date date default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_old_status text;
  v_position text;
  v_branch text;
begin
  if p_new_status not in ('applied', 'interviewing', 'selected', 'training', 'on_hold', 'hired', 'rejected') then
    raise exception 'Invalid status: %', p_new_status;
  end if;

  select company_id, status, position, branch
  into v_company_id, v_old_status, v_position, v_branch
  from hr_candidates
  where id = p_candidate_id
  for update;

  if v_company_id is null then
    raise exception 'Candidate not found';
  end if;
  if v_company_id <> auth_company_id() then
    raise exception 'Not authorized for this candidate';
  end if;

  if v_old_status = p_new_status then
    if p_new_status = 'interviewing' and p_effective_date is not null then
      update hr_candidates set interview_date = p_effective_date where id = p_candidate_id;
    elsif p_new_status = 'training' and p_effective_date is not null then
      update hr_candidates set training_start_date = p_effective_date where id = p_candidate_id;
    end if;
    return;
  end if;

  update hr_candidates
  set status = p_new_status,
      interview_date = case when p_new_status = 'interviewing' then coalesce(p_effective_date, interview_date) else interview_date end,
      training_start_date = case when p_new_status = 'training' then coalesce(p_effective_date, training_start_date) else training_start_date end
  where id = p_candidate_id;

  insert into hr_candidate_status_history
    (company_id, candidate_id, from_status, to_status, position, branch, effective_date, changed_by)
  values
    (v_company_id, p_candidate_id, v_old_status, p_new_status, v_position, v_branch, p_effective_date, auth_profile_id());

  if p_new_status = 'hired' and v_old_status <> 'hired' then
    update hr_staffing_targets
    set staff_needed = staff_needed - 1
    where company_id = v_company_id and position = v_position and branch = v_branch;
  elsif v_old_status = 'hired' and p_new_status <> 'hired' then
    update hr_staffing_targets
    set staff_needed = staff_needed + 1
    where company_id = v_company_id and position = v_position and branch = v_branch;
  end if;
end;
$$;

-- ---------- 4. set_company_id(): drop the now-pointless is_superadmin() branch ----------
-- Verified safe: profiles doesn't use this trigger at all (it has its own
-- stamp_profile_company() trigger, 0001_init.sql:1000-1014, which only fills
-- in company_id when the caller left it null — untouched by this migration
-- and still how createSupabaseAdminProfile creates company-scoped admins/
-- SUPERADMINs for arbitrary companies). This trigger only ever ran on the
-- 60 business tables above, which the platform role can no longer write to
-- regardless, so the is_superadmin() early-return has nothing left to do.
create or replace function set_company_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.company_id := auth_company_id();
  return new;
end;
$$;

-- Run once in the Supabase SQL Editor.
-- =====================================================================
