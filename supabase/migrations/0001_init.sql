-- =====================================================================
-- AH Solutions — Initial Supabase Schema (Step 1)
-- Multi-tenant field service platform. Every business table is scoped
-- by company_id and protected by Row Level Security (RLS).
-- Login stays in Firebase; the JWT carries the Firebase uid as `sub`.
-- Run this once in the Supabase SQL Editor.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- =====================================================================
-- 1. FOUNDATIONS: companies, profiles, user_settings
-- =====================================================================

create table companies (
  id              uuid primary key default uuid_generate_v4(),
  legacy_code     text unique,
  company_name    text not null,
  address         text,
  city            text,
  state           text,
  zip_code        text,
  phone_number    text,
  email           text,
  is_active       boolean not null default true,
  subscription_plan text default 'basic'
                  check (subscription_plan in ('basic','professional','enterprise')),
  subscription_expires_at timestamptz,
  settings        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now()
);

create table profiles (
  id              uuid primary key default uuid_generate_v4(),
  firebase_uid    text unique not null,
  company_id      uuid references companies(id) on delete cascade,
  email           text not null,
  username        text,
  display_name    text,
  role            text not null default 'TECHNICIAN'
                  check (role in ('SUPERADMIN','ADMIN','MANAGER','CSR',
                                  'TECHNICIAN','CLAIMS','HR','IT','PARTS','FINANCE')),
  phone_number    text,
  employee_id     uuid,
  department      text,
  manager_name    text,
  assigned_branch text,
  branch_access   text,
  technician_id   text,
  po_initials     text,
  required_check_in  text,
  required_check_out text,
  permissions     text[] default '{}',
  is_active       boolean not null default true,
  last_login      timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references profiles(id),
  updated_at      timestamptz not null default now(),
  unique (company_id, username)
);
create index idx_profiles_company on profiles(company_id);
create index idx_profiles_firebase on profiles(firebase_uid);

-- =====================================================================
-- HELPER FUNCTIONS (defined after profiles exists, since they query it)
-- NOTE: SECURITY DEFINER so they bypass RLS when reading `profiles`,
-- otherwise the profiles RLS policy would call these -> which query
-- profiles -> infinite recursion ("stack depth limit exceeded").
-- =====================================================================

create or replace function auth_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;

create or replace function auth_profile_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;

create or replace function is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and role = 'SUPERADMIN'
  );
$$;

create or replace function set_company_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_superadmin() and new.company_id is not null then
    return new;
  end if;
  new.company_id := auth_company_id();
  return new;
end;
$$;

create table user_settings (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  app_settings    jsonb default '{}'::jsonb,
  privacy_settings jsonb default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  unique (profile_id)
);

-- =====================================================================
-- 2. LOCATIONS & service accounts
-- =====================================================================

create table locations (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null,
  region          text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (company_id, name)
);

create table location_addresses (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  location_id     uuid not null references locations(id) on delete cascade,
  label           text,
  address text, city text, state text, zip text,
  zoom_address    text,
  is_default      boolean default false,
  created_at      timestamptz not null default now()
);

-- =====================================================================
-- 3. EMPLOYEES & HR
-- =====================================================================

create table employees (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid references profiles(id),
  legacy_id       text,
  full_name       text not null,
  email           text,
  role            text,
  department      text,
  manager_id      uuid references employees(id),
  primary_location_id uuid references locations(id),
  technician_code text,
  po_initials     text,
  country         text not null default 'US' check (country in ('US','PH')),
  currency        text not null default 'USD',
  hire_date       date,
  terminate_date  date,
  hourly_rate     numeric(10,2) default 0,
  status          text not null default 'Active'
                  check (status in ('Active','Inactive','On Leave')),
  required_check_in  time,
  required_check_out time,
  off_days        int[] default '{5,6}',
  bank_name       text,
  routing_number  text,
  account_number  text,
  ssn             text,
  home_address    jsonb,
  birth_date      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_employees_company on employees(company_id);

alter table profiles
  add constraint fk_profiles_employee
  foreign key (employee_id) references employees(id);

create table technician_locations (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  location_id     uuid not null references locations(id) on delete cascade,
  is_primary      boolean not null default false,
  unique (employee_id, location_id)
);

create table service_accounts (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  account_code    text,
  account_type    text,
  technician_id   uuid references employees(id),
  technician_external_id text,
  note            text,
  created_at      timestamptz not null default now()
);

create table salary_entries (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  effective_date  date not null,
  hourly_rate     numeric(10,2) not null,
  reason          text not null check (reason in ('promotion','demotion','adjustment','initial')),
  notes           text,
  created_at      timestamptz not null default now()
);

create table hr_candidates (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  full_name       text not null,
  position        text,
  branch_location_id uuid references locations(id),
  stage           text check (stage in ('applied','interview','offer','hired','rejected','warned','terminated')),
  interview_date  date,
  notes           text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create table attendance_notes (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid references employees(id) on delete cascade,
  note_date       date not null,
  content         text not null,
  notify_individual boolean default false,
  notify_team_lead  boolean default false,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create table employee_audit_log (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid references employees(id) on delete cascade,
  field           text,
  old_value       text,
  new_value       text,
  action          text check (action in ('created','edited','deleted')),
  edited_by       uuid references profiles(id),
  created_at      timestamptz not null default now()
);

-- =====================================================================
-- 4. CUSTOMERS
-- =====================================================================

create table customers (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  first_name      text,
  last_name       text,
  full_name       text,
  phone           text,
  second_phone    text,
  email           text,
  address         text,
  city            text,
  state           text,
  zip             text,
  address_note    text,
  created_at      timestamptz not null default now()
);
create index idx_customers_company on customers(company_id);

-- =====================================================================
-- 5. TICKETS, VISITS, PARTS
-- =====================================================================

create table tickets (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_no       text not null,
  customer_id     uuid references customers(id),
  location_id     uuid references locations(id),
  location        text,
  assigned_tech_id uuid references employees(id),
  technician      text,
  ticket_source   text,
  warranty        text,
  manufacturer    text,
  account         text,
  claim_company   text,
  model           text,
  model_version   text,
  serial          text,
  product_type    text,
  purchase_date   date,
  status          text,
  part_order      text,
  flow_type       text check (flow_type in ('FTF','RESCHEDULE','BACKORDER')),
  stage           text check (stage in
                    ('Schedule','Triage','PO','Receive','Service','Complete',
                     'Reschedule','BackOrder','Claim','Techpay')),
  diagnosed       boolean default false,
  customer_pref   boolean default false,
  redo            boolean default false,
  type            text,
  schedule_date   date,
  time_slot       text,
  call_received_date date,
  aging           int default 0,
  calls           int default 0,
  delay           int default 0,
  internal_note   text,
  fake_ticket     boolean default false,
  original_ticket_no text,
  status_changed_at timestamptz,
  status_changed_by uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, ticket_no)
);
create index idx_tickets_company on tickets(company_id);
create index idx_tickets_status on tickets(company_id, status);
create index idx_tickets_tech on tickets(assigned_tech_id);
create index idx_tickets_schedule on tickets(company_id, schedule_date);
alter table tickets add constraint tickets_id_company unique (id, company_id);

create table visits (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null,
  visit_no        text,
  technician_id   uuid references employees(id),
  technician      text,
  schedule_date   date,
  time_slot       text,
  activity        text,
  action_type     text,
  repair_status   text,
  repair_type     text,
  sched_notes     text,
  symptom_csr     text,
  cause_of_failure text,
  repair_notes    text,
  non_completion_reason text,
  triage_note     text,
  status          text,
  note            text,
  created_by      uuid references profiles(id),
  updated_by      uuid references profiles(id),
  update_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint visits_ticket_same_company
    foreign key (ticket_id, company_id) references tickets(id, company_id) on delete cascade
);
create index idx_visits_ticket on visits(ticket_id);
alter table visits add constraint visits_id_company unique (id, company_id);

create table parts (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null,
  visit_id        uuid,
  part_no         text,
  part_dist       text,
  part_desc       text,
  quantity        numeric(10,2) default 1,
  part_price      numeric(10,2) default 0,
  core_value      numeric(10,2) default 0,
  ship_cost       numeric(10,2) default 0,
  markup          numeric(10,2) default 0,
  total_markup    numeric(10,2) default 0,
  claim_to        text,
  status          text,
  po_no           text,
  po_date         date,
  invoice_no      text,
  invoice_date    date,
  order_no        text,
  eta             date,
  in_tracking     text,
  out_tracking    text,
  ra_date         date,
  ra_no           text,
  credit_no       text,
  hold            boolean default false,
  cx_paid         boolean default false,
  note            text,
  created_by      uuid references profiles(id),
  last_modified_by uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint parts_ticket_same_company
    foreign key (ticket_id, company_id) references tickets(id, company_id) on delete cascade
);
create index idx_parts_ticket on parts(ticket_id);

create table ticket_alerts (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null,
  text            text not null,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  constraint alerts_ticket_same_company
    foreign key (ticket_id, company_id) references tickets(id, company_id) on delete cascade
);

create table ticket_audit_log (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null,
  action          text,
  field           text,
  before_value    text,
  after_value     text,
  changed_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  constraint audit_ticket_same_company
    foreign key (ticket_id, company_id) references tickets(id, company_id) on delete cascade
);
create index idx_ticket_audit_ticket on ticket_audit_log(ticket_id, created_at desc);

create table ticket_visit_log (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null,
  visit_id        uuid references visits(id) on delete set null,
  action          text,
  detail          text,
  by_profile_id   uuid references profiles(id),
  created_at      timestamptz not null default now(),
  constraint visitlog_ticket_same_company
    foreign key (ticket_id, company_id) references tickets(id, company_id) on delete cascade
);

create table sms_messages (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid references tickets(id) on delete set null,
  customer_id     uuid references customers(id) on delete set null,
  direction       text check (direction in ('inbound','outbound')),
  phone_number    text,
  body            text,
  sent_at         timestamptz not null default now()
);

-- =====================================================================
-- 6. PARTS OPERATIONS
-- =====================================================================

create table part_orders (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  po_no           text not null,
  ticket_id       uuid references tickets(id) on delete set null,
  ticket_no       text,
  part_no         text,
  part_dist       text,
  part_desc       text,
  quantity        numeric(10,2) default 1,
  part_price      numeric(10,2) default 0,
  po_date         date,
  eta             date,
  invoice_no      text,
  invoice_date    date,
  order_no        text,
  in_tracking     text,
  out_tracking    text,
  status          text default 'Need PO'
                  check (status in ('Need PO','PO Made','Back Order','Part Ready',
                                    'Tech Pickup','Claimed','Used','Cancelled')),
  item_status     text default 'No-Invoice'
                  check (item_status in ('No-Invoice','Invoiced','Received','Claimed')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, po_no)
);

create table part_pickups (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  unique_code     text,
  ticket_id       uuid references tickets(id) on delete set null,
  ticket_no       text,
  technician_id   uuid references employees(id),
  part_no         text,
  description     text,
  po_no           text,
  eta             date,
  qty             numeric(10,2) default 1,
  part_status     text,
  repair_status   text,
  core_value      numeric(10,2) default 0,
  picked_up       date,
  cx_address      text,
  transit         text,
  zone            text,
  location_id     uuid references locations(id),
  comment         text,
  created_at      timestamptz not null default now()
);

create table part_collections (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  unique_code     text,
  ticket_id       uuid references tickets(id) on delete set null,
  ticket_no       text,
  technician_id   uuid references employees(id),
  part_no         text,
  description     text,
  picked_up       date,
  collected       date,
  qty             numeric(10,2) default 0,
  used_qty        numeric(10,2) default 0,
  restock_qty     numeric(10,2) default 0,
  collect_type    text,
  lot_no          text,
  core_value      numeric(10,2) default 0,
  repair_status   text,
  part_status_desc text,
  location_id     uuid references locations(id),
  comment         text,
  created_at      timestamptz not null default now()
);

create table part_receipts (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  part_no         text,
  description     text,
  parts_from      text,
  location_id     uuid references locations(id),
  qty             numeric(10,2),
  received_date   date,
  received_by     uuid references employees(id),
  created_at      timestamptz not null default now()
);

create table part_returns (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  part_no         text,
  description     text,
  vendor          text,
  reason          text,
  ra_no           text,
  return_type     text check (return_type in ('Regular','Core')),
  status          text,
  pickup_date     date,
  ticket_id       uuid references tickets(id) on delete set null,
  created_at      timestamptz not null default now()
);

create table part_inventory (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  location_id     uuid references locations(id),
  part_no         text not null,
  description     text,
  vendor          text,
  bin             text,
  on_hand         numeric(10,2) default 0,
  reorder_point   numeric(10,2) default 0,
  cost            numeric(12,2) default 0,
  updated_at      timestamptz not null default now(),
  unique (company_id, location_id, part_no)
);

create table part_transactions (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  part_no         text not null,
  description     text,
  vendor          text,
  action          text check (action in ('Received','Issued','Returned','Adjusted')),
  qty             numeric(10,2),
  location_id     uuid references locations(id),
  ticket_id       uuid references tickets(id) on delete set null,
  occurred_at     timestamptz not null default now()
);

-- =====================================================================
-- 7. CLAIMS
-- =====================================================================

create table claims (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  claim_no        text,
  ticket_id       uuid references tickets(id) on delete set null,
  brand           text,
  status          text,
  amount          numeric(12,2),
  submitted_at    timestamptz,
  scheduled_date  date,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  unique (company_id, claim_no)
);

create table claim_authorizations (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  auth_no         text,
  claim_id        uuid references claims(id) on delete cascade,
  ticket_id       uuid references tickets(id) on delete set null,
  status          text check (status in ('requested','pending','approved','denied')),
  requested_at    timestamptz,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- =====================================================================
-- 8. TIME / PAYROLL / EXPENSES / ACTIVITY
-- =====================================================================

create table timecard_entries (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid references employees(id) on delete cascade,
  profile_id      uuid references profiles(id) on delete cascade,
  work_date       date not null,
  day_of_week     text,
  check_in        text,
  check_out       text,
  meal_start      text,
  meal_end        text,
  lunch_start     text,
  lunch_end       text,
  hours_worked    numeric(6,2) default 0,
  overtime_hours  numeric(6,2) default 0,
  status          text default 'present'
                  check (status in ('present','absent','late','pto','holiday')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index idx_timecard_emp_date on timecard_entries(employee_id, work_date);

create table pto_requests (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  pto_type        text not null default 'vacation'
                  check (pto_type in ('vacation','sick','personal','holiday','unpaid','bereavement')),
  start_date      date not null,
  end_date        date not null,
  hours_requested numeric(6,2) not null,
  reason          text,
  status          text not null default 'pending'
                  check (status in ('pending','approved','denied','cancelled')),
  requested_by    uuid references profiles(id),
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz not null default now()
);

create table payroll_runs (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  status          text not null default 'draft'
                  check (status in ('draft','generated','approved','paid')),
  generated_by    uuid references profiles(id),
  generated_at    timestamptz,
  created_at      timestamptz not null default now()
);
alter table payroll_runs add constraint payroll_runs_id_company unique (id, company_id);

create table payroll_line_items (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  payroll_run_id  uuid not null,
  employee_id     uuid not null references employees(id),
  hours_worked    numeric(8,2) default 0,
  overtime_hours  numeric(8,2) default 0,
  hourly_rate     numeric(10,2) default 0,
  regular_pay     numeric(12,2) default 0,
  overtime_pay    numeric(12,2) default 0,
  pto_hours       numeric(8,2) default 0,
  pto_pay         numeric(12,2) default 0,
  holiday_pay     numeric(12,2) default 0,
  gross_pay       numeric(12,2) default 0,
  deductions      numeric(12,2) default 0,
  net_pay         numeric(12,2) default 0,
  currency        text default 'USD',
  salary_change_occurred boolean default false,
  breakdown       jsonb,
  created_at      timestamptz not null default now(),
  constraint pli_run_same_company
    foreign key (payroll_run_id, company_id) references payroll_runs(id, company_id) on delete cascade
);

create table payroll_audit_log (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  action          text check (action in ('generate','edit','delete')),
  employee_id     uuid references employees(id),
  employee_name   text,
  details         text,
  amount          numeric(12,2),
  user_id         uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create table expenses (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid references employees(id),
  category        text check (category in ('Travel','Supplies','Meals','Other')),
  expense_date    date,
  amount          numeric(12,2),
  description     text,
  status          text default 'Pending' check (status in ('Pending','Approved','Reimbursed')),
  created_at      timestamptz not null default now()
);

create table daily_activity_reports (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  technician_id   uuid references employees(id),
  activity_type   text,
  tickets_closed  int default 0,
  tickets_opened  int default 0,
  miles           numeric(8,1) default 0,
  report_date     date not null,
  created_at      timestamptz not null default now()
);

-- =====================================================================
-- 9. CSR / CALLS
-- =====================================================================

create table csr_activity (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  agent_id        uuid references profiles(id),
  activity_date   date not null,
  tasks_completed int default 0,
  scheduled       int default 0,
  attempts        int default 0,
  mistakes        int default 0,
  status          text,
  created_at      timestamptz not null default now()
);

create table call_logs (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  agent_id        uuid references profiles(id),
  ticket_id       uuid references tickets(id) on delete set null,
  direction       text check (direction in ('inbound','outbound')),
  phone_number    text,
  duration_seconds int,
  outcome         text,
  notes           text,
  called_at       timestamptz not null default now()
);

-- =====================================================================
-- 10. MESSAGING
-- =====================================================================

create table message_channels (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  slug            text not null,
  title           text not null,
  subtitle        text,
  kind            text not null default 'channel' check (kind in ('channel','dm')),
  is_announcement boolean not null default false,
  is_system       boolean not null default false,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  unique (company_id, slug)
);
alter table message_channels add constraint mc_id_company unique (id, company_id);

create table dm_threads (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  participant_a   uuid not null references profiles(id) on delete cascade,
  participant_b   uuid not null references profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (company_id, participant_a, participant_b)
);
alter table dm_threads add constraint dm_id_company unique (id, company_id);

create table messages (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  channel_id      uuid,
  dm_thread_id    uuid,
  sender_id       uuid references profiles(id),
  sender_name     text,
  body            text not null,
  kind            text not null default 'user' check (kind in ('system','user')),
  is_announcement boolean not null default false,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  constraint msg_one_parent check (
    (channel_id is not null and dm_thread_id is null) or
    (channel_id is null and dm_thread_id is not null)
  ),
  constraint messages_channel_same_company
    foreign key (channel_id, company_id) references message_channels(id, company_id) on delete cascade,
  constraint messages_dm_same_company
    foreign key (dm_thread_id, company_id) references dm_threads(id, company_id) on delete cascade
);
create index idx_messages_channel on messages(channel_id, created_at);
create index idx_messages_dm on messages(dm_thread_id, created_at);

create table message_reads (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  channel_id      uuid references message_channels(id) on delete cascade,
  dm_thread_id    uuid references dm_threads(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  unique (profile_id, channel_id),
  unique (profile_id, dm_thread_id)
);

create table channel_members (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  channel_id      uuid not null references message_channels(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  role            text default 'member' check (role in ('member','moderator')),
  joined_at       timestamptz not null default now(),
  unique (channel_id, profile_id)
);

-- =====================================================================
-- 11. CONFIG
-- =====================================================================

create table repair_statuses (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  code            text not null,
  label           text not null,
  color           text,
  sort_order      int default 0,
  is_active       boolean default true,
  unique (company_id, code)
);

-- =====================================================================
-- 12. TICKET AUDIT TRIGGER (captures WHO changed status/tech/schedule)
-- =====================================================================

create or replace function log_ticket_change()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into ticket_audit_log(company_id, ticket_id, action, field, before_value, after_value, changed_by)
    values (new.company_id, new.id, 'status_change', 'status', old.status, new.status, auth_profile_id());
    new.status_changed_by := auth_profile_id();
    new.status_changed_at := now();
  end if;
  if new.assigned_tech_id is distinct from old.assigned_tech_id then
    insert into ticket_audit_log(company_id, ticket_id, action, field, before_value, after_value, changed_by)
    values (new.company_id, new.id, 'reassign', 'assigned_tech_id',
            old.assigned_tech_id::text, new.assigned_tech_id::text, auth_profile_id());
  end if;
  if new.schedule_date is distinct from old.schedule_date then
    insert into ticket_audit_log(company_id, ticket_id, action, field, before_value, after_value, changed_by)
    values (new.company_id, new.id, 'reschedule', 'schedule_date',
            old.schedule_date::text, new.schedule_date::text, auth_profile_id());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_ticket_audit
  before update on tickets
  for each row execute function log_ticket_change();

-- =====================================================================
-- 13. ENABLE RLS + COMPANY-SCOPED POLICIES + COMPANY-ID AUTO-STAMP
-- =====================================================================

do $$
declare
  t text;
  tenant_tables text[] := array[
    'user_settings','locations','location_addresses','employees','technician_locations',
    'service_accounts','salary_entries','hr_candidates','attendance_notes','employee_audit_log',
    'customers','tickets','visits','parts','ticket_alerts','ticket_audit_log','ticket_visit_log',
    'sms_messages','part_orders','part_pickups','part_collections','part_receipts','part_returns',
    'part_inventory','part_transactions','claims','claim_authorizations','timecard_entries',
    'pto_requests','payroll_runs','payroll_line_items','payroll_audit_log','expenses',
    'daily_activity_reports','csr_activity','call_logs','message_channels','dm_threads',
    'messages','message_reads','channel_members','repair_statuses'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);

    execute format($f$
      create policy %1$s_select on %1$I
      for select using (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format($f$
      create policy %1$s_insert on %1$I
      for insert with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format($f$
      create policy %1$s_update on %1$I
      for update using (company_id = auth_company_id() or is_superadmin())
                  with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format($f$
      create policy %1$s_delete on %1$I
      for delete using (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format($f$
      create trigger trg_%1$s_company
      before insert on %1$I
      for each row execute function set_company_id();
    $f$, t);
  end loop;
end $$;

-- messages: tighten the announcement insert rule (higher-ups only)
drop policy if exists messages_insert on messages;
create policy messages_insert on messages
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (
      is_announcement = false
      or exists (
        select 1 from profiles p
        where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
          and p.role in ('SUPERADMIN','ADMIN','MANAGER','HR')
      )
    )
  );

-- =====================================================================
-- 14. PROFILES & COMPANIES policies (special: needed for login lookup)
-- =====================================================================

alter table profiles enable row level security;
alter table profiles force row level security;

create policy profiles_select on profiles
  for select using (
    firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    or company_id = auth_company_id()
    or is_superadmin()
  );

create policy profiles_insert on profiles
  for insert with check (company_id = auth_company_id() or is_superadmin());

create policy profiles_update on profiles
  for update using (
    firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
    or company_id = auth_company_id()
    or is_superadmin()
  )
  with check (company_id = auth_company_id() or is_superadmin());

create policy profiles_delete on profiles
  for delete using (company_id = auth_company_id() or is_superadmin());

alter table companies enable row level security;
alter table companies force row level security;

create policy companies_select on companies
  for select using (id = auth_company_id() or is_superadmin());

create policy companies_insert on companies
  for insert with check (is_superadmin());
create policy companies_update on companies
  for update using (is_superadmin()) with check (is_superadmin());
create policy companies_delete on companies
  for delete using (is_superadmin());

-- =====================================================================
-- PROFILES company auto-stamp: when an admin/HR creates a user, the new
-- profile inherits the CREATOR's company_id (resolved from their JWT).
-- The client never sends company_id, so it can't be spoofed or mismatched.
-- =====================================================================

create or replace function stamp_profile_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

create trigger trg_profiles_stamp_company
  before insert on profiles
  for each row execute function stamp_profile_company();

-- =====================================================================
-- DONE.
-- =====================================================================

-- =====================================================================
-- 15. GRANTS
-- RLS controls WHICH ROWS are visible, but roles still need table-level
-- privileges to access tables at all. (Required especially if the public
-- schema was dropped/recreated, which removes Supabase's default grants.)
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
