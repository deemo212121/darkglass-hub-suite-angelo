# AH Solutions — Complete Supabase Database Map & Flow

This document maps every data domain in the app into a Supabase (PostgreSQL) schema. Firebase Auth stays as the identity provider; Supabase becomes the system of record for all business data (tickets, payroll, parts, timecards, PTO, etc.).

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                       │
│  TanStack Router • Components • lib/* data services            │
└───────────────┬───────────────────────────┬───────────────────┘
                │                           │
        Firebase Auth                  Supabase Client
     (identity / login)            (all business data + RLS)
                │                           │
                ▼                           ▼
   ┌────────────────────┐      ┌──────────────────────────────┐
   │  Firebase           │      │  Supabase (PostgreSQL)        │
   │  - auth.users       │ uid  │  - profiles (maps fb uid)     │
   │  - companies (move) │─────▶│  - companies                  │
   │  - users (move)     │      │  - tickets / visits / parts   │
   └────────────────────┘      │  - payroll / timecards / PTO  │
                                │  - RLS scoped by company_id   │
                                └──────────────────────────────┘
```

**Key decisions**
- **Identity**: Firebase Auth issues the login. We store the Firebase `uid` on a Supabase `profiles` row so Postgres RLS can scope every query by `company_id`.
- **Multi-tenancy**: every business table carries `company_id`. RLS guarantees a user only sees their own company. `SUPERADMIN` bypasses the filter.
- **Source of truth**: Supabase replaces all the current `localStorage` keys (`ahs:tickets:data`, `ah-solutions:part-orders`, `partPickupRows`, `tc_entries`, `payroll_employees`, etc.).

---

## 2. Entity Relationship Overview

```
companies ──┬──< profiles (users)            (1 company → many users)
            ├──< employees ──┬──< salary_entries
            │                ├──< timecard_entries
            │                ├──< pto_requests
            │                ├──< attendance_notes
            │                ├──< payroll_runs ──< payroll_line_items
            │                └──< employee_audit_log
            ├──< locations ──< technician_locations >── employees
            ├──< customers ──< tickets
            └──< tickets ──┬──< visits ──< parts
                           ├──< part_orders
                           ├──< part_pickups
                           ├──< part_collections
                           ├──< ticket_alerts
                           └──< ticket_audit_log
```

**Relationship summary**
| Parent | Child | Type |
|--------|-------|------|
| companies | profiles, employees, locations, customers, tickets | 1 → N |
| customers | tickets | 1 → N |
| tickets | visits, part_orders, ticket_alerts, ticket_audit_log | 1 → N |
| visits | parts | 1 → N |
| employees | salary_entries, timecard_entries, pto_requests, payroll_line_items | 1 → N |
| locations | tickets, technician_locations | 1 → N |
| employees ↔ locations | technician_locations | N ↔ N |

---

## 3. Table-by-Table Schema (SQL)

### 3.1 Foundations: companies & profiles

```sql
-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============ COMPANIES (tenant root) ============
create table companies (
  id              uuid primary key default uuid_generate_v4(),
  legacy_code     text unique,                 -- old "COMP001" code for migration
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
  settings        jsonb default '{}'::jsonb,   -- timezone, dateFormat, currency
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now()
);

-- ============ PROFILES (maps Firebase uid → company) ============
create table profiles (
  id              uuid primary key default uuid_generate_v4(),
  firebase_uid    text unique not null,        -- link to Firebase Auth
  company_id      uuid references companies(id) on delete cascade,
  email           text not null,
  username        text,                         -- FirstName.LastName
  display_name    text,
  role            text not null default 'TECHNICIAN'
                  check (role in ('SUPERADMIN','ADMIN','MANAGER','CSR',
                                  'TECHNICIAN','DISPATCHER','HR','IT','PARTS','FINANCE')),
  phone_number    text,
  employee_id     uuid,                         -- FK added after employees table
  department      text,
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
```

### 3.2 Locations & Technicians

```sql
-- ============ LOCATIONS / BRANCHES ============
create table locations (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null,               -- "Memphis", "Atlanta", ...
  region          text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (company_id, name)
);

-- ============ TECHNICIAN ↔ LOCATION (many-to-many) ============
create table technician_locations (
  id              uuid primary key default uuid_generate_v4(),
  employee_id     uuid not null,               -- FK → employees
  location_id     uuid not null references locations(id) on delete cascade,
  is_primary      boolean not null default false,
  unique (employee_id, location_id)
);
```

### 3.3 Employees & HR

```sql
-- ============ EMPLOYEES ============
create table employees (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid references profiles(id), -- link to login (nullable: not all employees log in)
  legacy_id       text,                          -- old "emp-us-001" / technicianId
  full_name       text not null,
  email           text,
  role            text,                          -- Admin|Manager|Technician|CSR|...
  department      text,
  manager_id      uuid references employees(id), -- self-reference
  primary_location_id uuid references locations(id),
  technician_code text,                          -- "SIMSA08016145"
  po_initials     text,                          -- PO # initials
  country         text not null default 'US' check (country in ('US','PH')),
  currency        text not null default 'USD',
  hire_date       date,
  terminate_date  date,
  hourly_rate     numeric(10,2) default 0,
  status          text not null default 'Active'
                  check (status in ('Active','Inactive','On Leave')),
  -- required schedule
  required_check_in  time,
  required_check_out time,
  off_days        int[] default '{5,6}',         -- 0=Mon ... 6=Sun
  -- banking / sensitive (consider separate encrypted table)
  bank_name       text,
  routing_number  text,
  account_number  text,
  ssn             text,
  home_address    jsonb,                          -- {address1,address2,city,state,zip}
  birth_date      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_employees_company on employees(company_id);

-- add deferred FK from profiles → employees
alter table profiles
  add constraint fk_profiles_employee
  foreign key (employee_id) references employees(id);

-- ============ SALARY HISTORY (pro-rata payroll) ============
create table salary_entries (
  id              uuid primary key default uuid_generate_v4(),
  employee_id     uuid not null references employees(id) on delete cascade,
  effective_date  date not null,
  hourly_rate     numeric(10,2) not null,
  reason          text not null check (reason in ('promotion','demotion','adjustment','initial')),
  notes           text,
  created_at      timestamptz not null default now()
);
```

### 3.4 Customers & Products

```sql
-- ============ CUSTOMERS ============
create table customers (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  first_name      text,
  last_name       text,
  full_name       text,                          -- denormalized display
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
```

### 3.5 Tickets, Visits, Parts (core)

```sql
-- ============ TICKETS ============
create table tickets (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_no       text not null,                 -- natural key, unique per company
  customer_id     uuid references customers(id),
  location_id     uuid references locations(id),
  assigned_tech_id uuid references employees(id),

  ticket_source   text,                          -- LG, SB, SP, NSA MEMPHIS...
  warranty        text,                          -- IW / OW
  manufacturer    text,
  account         text,                          -- GSL00002, MEM001
  claim_company   text,

  -- product snapshot
  model           text,
  model_version   text,
  serial          text,
  product_type    text,
  purchase_date   date,

  -- status & workflow
  status          text,                          -- REPAIR_STATUS_OPTIONS
  part_order      text,                          -- "Not Diagnosed"|"Part Ordered"...
  diagnosed       boolean default false,
  customer_pref   boolean default false,
  redo            boolean default false,
  type            text,                          -- SMS|Phone
  schedule_date   date,
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

-- ============ VISITS ============
create table visits (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null references tickets(id) on delete cascade,
  visit_no        text,
  technician_id   uuid references employees(id),
  schedule_date   date,
  time_slot       text,                          -- AM | PM | ANYTIME
  activity        text,
  action_type     text,                          -- SCHEDULE|ACKNOWLEDGE|COMPLETED...
  repair_status   text,
  repair_type     text,
  sched_notes     text,
  symptom_csr     text,                          -- "Symptom (CSR)"
  cause_of_failure text,                         -- "Cause of Failure (Tech)"
  repair_notes    text,                          -- "Repair Notes (Tech)"
  non_completion_reason text,
  triage_note     text,
  status          text,
  note            text,
  created_by      uuid references profiles(id),
  updated_by      uuid references profiles(id),
  update_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_visits_ticket on visits(ticket_id);

-- ============ PARTS (line items on a ticket/visit) ============
create table parts (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null references tickets(id) on delete cascade,
  visit_id        uuid references visits(id) on delete set null,
  part_no         text,
  part_dist       text,                          -- distributor (Encompass, GE...)
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
  updated_at      timestamptz not null default now()
);

create index idx_parts_ticket on parts(ticket_id);
```

### 3.6 Part Orders (PO Management), Pickups, Collections

```sql
-- ============ PART ORDERS (PO dashboard) ============
create table part_orders (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  po_no           text not null,                 -- PO-YYMMDD-XXX
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

-- ============ PART PICKUPS (tech picks up part) ============
create table part_pickups (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  unique_code     text,                          -- "uniqueId" in UI
  ticket_id       uuid references tickets(id) on delete set null,
  ticket_no       text,
  technician_id   uuid references employees(id),
  part_no         text,
  description     text,
  po_no           text,
  eta             date,
  qty             numeric(10,2) default 1,
  part_status     text,                          -- Used|Tech Pickup|Part Ready|...
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

-- ============ PART COLLECTIONS (used/restock reconciliation) ============
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
  collect_type    text,                          -- Used | Restock
  lot_no          text,
  core_value      numeric(10,2) default 0,
  repair_status   text,
  part_status_desc text,
  location_id     uuid references locations(id),
  comment         text,
  created_at      timestamptz not null default now()
);
```

### 3.7 Timecards, PTO, Payroll

```sql
-- ============ TIMECARD ENTRIES ============
create table timecard_entries (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  work_date       date not null,
  day_of_week     text,
  check_in        timestamptz,
  check_out       timestamptz,
  meal_start      timestamptz,
  meal_end        timestamptz,
  lunch_start     timestamptz,
  lunch_end       timestamptz,
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

-- ============ PTO REQUESTS ============
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

-- ============ PAYROLL RUNS (a pay period batch) ============
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

-- ============ PAYROLL LINE ITEMS (per employee per run) ============
create table payroll_line_items (
  id              uuid primary key default uuid_generate_v4(),
  payroll_run_id  uuid not null references payroll_runs(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
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
  breakdown       jsonb,                          -- store split portions
  created_at      timestamptz not null default now()
);
```

### 3.8 Audit, Alerts, Attendance Notes

```sql
-- ============ TICKET ALERTS / MESSAGES ============
create table ticket_alerts (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null references tickets(id) on delete cascade,
  text            text not null,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

-- ============ TICKET AUDIT LOG (scheduling/status changes) ============
create table ticket_audit_log (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_id       uuid not null references tickets(id) on delete cascade,
  action          text,
  field           text,
  before_value    text,
  after_value     text,
  changed_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

-- ============ ATTENDANCE NOTES ============
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

-- ============ PAYROLL AUDIT LOG ============
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

-- ============ EMPLOYEE / HR AUDIT LOG ============
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
```

---

## 4. Row Level Security (multi-tenant isolation)

Every business table is scoped by `company_id`. The pattern below uses a helper that reads the caller's company from their profile.

```sql
-- Helper: current user's company_id (based on Firebase uid in JWT claim)
create or replace function auth_company_id()
returns uuid
language sql stable
as $$
  select company_id from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;

-- Helper: is the caller a SUPERADMIN?
create or replace function is_superadmin()
returns boolean
language sql stable
as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and role = 'SUPERADMIN'
  );
$$;

-- Apply to every tenant table (example for tickets — repeat per table)
alter table tickets enable row level security;

create policy tickets_tenant_isolation on tickets
  for all
  using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());
```

Repeat the `enable row level security` + policy for: `employees`, `locations`, `customers`, `visits`, `parts`, `part_orders`, `part_pickups`, `part_collections`, `timecard_entries`, `pto_requests`, `payroll_runs`, `payroll_line_items`, `ticket_alerts`, `ticket_audit_log`, `attendance_notes`, `payroll_audit_log`, `employee_audit_log`, `salary_entries`, `technician_locations`.

> **Note on auth bridge**: Since login is Firebase, you need to pass a token Supabase trusts. Two options:
> 1. **Recommended**: Use Supabase Auth as well (sign the user into Supabase with the same email/password or a custom JWT) so `auth.uid()` works natively.
> 2. **Custom JWT**: Mint a JWT signed with the Supabase JWT secret containing the Firebase `uid` as `sub`, and the policies above read it. A small Edge Function or your existing `/api` backend can exchange a Firebase ID token for a Supabase JWT.

---

## 5. Data Flow Diagrams

### 5.1 Login & tenant resolution
```
User enters email/username + password + Company ID
        │
        ▼
Firebase Auth verifies credentials ──▶ returns Firebase uid + ID token
        │
        ▼
App exchanges Firebase token ──▶ Supabase JWT (sub = firebase_uid)
        │
        ▼
SELECT * FROM profiles WHERE firebase_uid = sub
        │
        ▼
profile.company_id  ──▶ stored in app auth context
        │
        ▼
All later queries auto-filtered by RLS to that company_id
```

### 5.2 Ticket lifecycle
```
CSR creates ticket
   └─▶ INSERT customers (if new) ─▶ INSERT tickets (status='CSR-Needs Scheduling')
        │
Dispatcher schedules
   └─▶ INSERT visits (time_slot=AM/PM, technician_id) ─▶ UPDATE tickets.status
        │
Technician diagnoses on-site
   └─▶ UPDATE visits (symptom_csr, cause_of_failure, repair_notes)
   └─▶ UPDATE tickets.diagnosed = true
        │
Parts needed?
   └─▶ INSERT parts (status='Need PO') ─▶ INSERT part_orders (po_no auto)
        │                                    status: Need PO → PO Made → Part Ready
        ▼
   └─▶ INSERT part_pickups (tech grabs part) ─▶ INSERT part_collections (used/restock)
        │
Repair completed
   └─▶ UPDATE visits.action_type='COMPLETED' ─▶ UPDATE tickets.status='CL-Ready to Complete'
        │
   Every status change ─▶ INSERT ticket_audit_log
```

### 5.3 Timecard → Payroll flow
```
Employee clocks in/out daily
   └─▶ UPSERT timecard_entries (check_in, check_out, meal_*, hours_worked)
        │
PTO requests
   └─▶ INSERT pto_requests (pending) ─▶ HR approves ─▶ status='approved'
        │                                 (approved PTO → timecard_entries.status='pto')
        ▼
Pay period closes → Finance generates payroll
   └─▶ INSERT payroll_runs (period_start, period_end, status='draft')
   └─▶ For each employee:
         • SUM timecard hours in period
         • Apply salary_entries effective on each day (pro-rata if rate changed)
         • Compute regular (≤40h) + overtime (>40h × 1.5)
         • Add pto_pay + holiday_pay
         • INSERT payroll_line_items
   └─▶ UPDATE payroll_runs.status='generated'
        │
   Every action ─▶ INSERT payroll_audit_log
```

### 5.4 Parts flow (detailed)
```
parts.status = Need PO
        │
        ▼
part_orders created (PO-YYMMDD-XXX)  status: Need PO
        │ purchasing orders from distributor
        ▼
status: PO Made ──▶ Back Order? ──▶ Part Ready (item_status: Invoiced→Received)
        │
        ▼
part_pickups (technician picks up)  part_status: Tech Pickup
        │
        ▼
part_collections  collect_type: Used → consumed on ticket
                                Restock → returned to inventory (restock_qty)
        │
        ▼
part_orders.status: Used / Claimed (core_value reconciled)
```

---

## 6. Migration Plan (localStorage / Firestore → Supabase)

| Step | Source | Target table | Notes |
|------|--------|-------------|-------|
| 1 | Firestore `companies` | `companies` | keep old code in `legacy_code` |
| 2 | Firestore `users` | `profiles` (+ `employees`) | map `uid`→`firebase_uid` |
| 3 | `src/lib/locations.ts` LOCATIONS | `locations` | seed per company |
| 4 | localStorage `ahs:tickets:data` | `tickets`,`customers`,`visits`,`parts` | split denormalized ticket |
| 5 | localStorage `ah-solutions:part-orders` | `part_orders` | |
| 6 | localStorage `partPickupRows` | `part_pickups` | |
| 7 | localStorage `partDailyCollectionRows` | `part_collections` | |
| 8 | localStorage `tc_entries` | `timecard_entries` | date-keyed map → rows |
| 9 | localStorage `payroll_employees` + `employee_details` | `employees` | |
| 10 | localStorage `payroll_audit_logs` | `payroll_audit_log` | |
| 11 | localStorage `ahs:ticket-audit:{ticketNo}` | `ticket_audit_log` | |

**Suggested code structure** (mirror the existing `src/lib/firebase/`):
```
src/lib/supabase/
  client.ts          -- createClient(url, anonKey)
  tickets.ts         -- getTickets(), createTicket(), updateTicketStatus()...
  visits.ts
  parts.ts
  partOrders.ts
  timecards.ts
  pto.ts
  payroll.ts
  employees.ts
  locations.ts
```
Each module replaces the matching `localStorage` read/write functions one-to-one, so components keep their existing shapes (the field names above were chosen to match the current TS interfaces).

---

## 7. Recommended Build Order

1. **Foundations** — `companies`, `profiles`, `locations`, RLS + auth bridge. Verify a logged-in user resolves to their company.
2. **Employees** — migrate users into `employees`, wire User Management page to Supabase.
3. **Tickets core** — `customers`, `tickets`, `visits`, `parts`. Wire ticket list + detail.
4. **Parts ops** — `part_orders`, `part_pickups`, `part_collections`. Wire PO dashboard.
5. **Timecards** — `timecard_entries`. Wire timecard page.
6. **PTO** — `pto_requests`. Wire request + approval.
7. **Payroll** — `payroll_runs`, `payroll_line_items`, `salary_entries`. Wire payroll generation.
8. **Audit & alerts** — remaining log tables.

Start at step 1 and keep each domain behind its own `src/lib/supabase/*.ts` service so the UI changes stay minimal.
```
```

---

## 8. Quick Reference — All Tables

| Table | Purpose |
|-------|---------|
| companies | Tenant root |
| profiles | Login identity ↔ company (Firebase uid bridge) |
| employees | HR/payroll profile |
| salary_entries | Rate change history |
| locations | Branches |
| technician_locations | Tech ↔ branch (N:N) |
| customers | Service customers |
| tickets | Service tickets/claims |
| visits | Scheduled service visits |
| parts | Part line items on tickets |
| part_orders | PO management dashboard |
| part_pickups | Tech part pickup tracking |
| part_collections | Used/restock reconciliation |
| timecard_entries | Daily clock in/out |
| pto_requests | Time-off requests + approval |
| payroll_runs | Pay period batches |
| payroll_line_items | Per-employee payroll |
| ticket_alerts | Ticket alert messages |
| ticket_audit_log | Ticket change history |
| attendance_notes | HR attendance notes |
| payroll_audit_log | Payroll change history |
| employee_audit_log | HR edit history |


---

## 9. Daily Schedule / Work Map Data Dependencies

The **Daily Schedule** (formerly Work Planner, route `/m/tickets/work-planner`) renders **three views off a single ticket source**: the **Work Map** (pins), the **work map ticket list**, and the **AM/PM/ANYTIME schedule columns**. All three read the same array — today `loadTickets()` from `src/lib/ticketData.ts`, after migration a single Supabase query on `tickets` + `visits`.

### What each view needs from the data

| View | Filters on | Supabase source |
|------|-----------|-----------------|
| Work Map (pins) | a geocodable address | `customers.address/city/state/zip` (joined to `tickets`) |
| Work map ticket list | scheduled date + branch | `tickets.schedule_date`, `tickets.location_id` |
| Daily schedule columns | visit time slot + technician | `visits.time_slot` (AM/PM/ANYTIME), `visits.technician_id` |

### A ticket shows up in the Daily Schedule when ALL are true
1. `tickets.schedule_date` = the selected day, **and**
2. `tickets.location_id` matches the selected branch filter (or no branch filter), **and**
3. it has a `visits` row with a `time_slot` and an assigned `technician_id`, **and**
4. (map pin only) the linked customer has an address that can be geocoded.

> The current UI flags address-less tickets as `unverifiedTickets` so they still appear in the list but not on the map.

### The single query that powers all three views
```sql
select t.*,
       c.address, c.city, c.state, c.zip, c.full_name as customer_name, c.phone,
       l.name as location_name,
       v.time_slot, v.technician_id, e.full_name as technician_name
from tickets t
left join customers c on c.id = t.customer_id
left join locations l on l.id = t.location_id
left join lateral (
  select * from visits
  where ticket_id = t.id
  order by created_at desc
  limit 1
) v on true
left join employees e on e.id = v.technician_id
where t.company_id = auth_company_id()        -- RLS also enforces this
  and t.schedule_date = :selected_date
  and (:location_id is null or t.location_id = :location_id);
```
- Work Map = rows that have an address → geocode → pin.
- Ticket list = all rows.
- Schedule columns = group rows by `technician_id` then by `v.time_slot`.

### Migration cleanup
Delete the leftover `readSeededTickets()` helper in `WorkPlannerPage.tsx` during migration. The live path already uses `loadTickets()`, but removing the seeded generator guarantees the map, list, and schedule can never diverge or show fake data.

---

## 10. Ticket Handling Flow (business lifecycle)

The system supports **three ticket paths**. All of them share the same early stages (Schedule → Triage → PO → Receive → Service) and then branch. Every box below is a `tickets.status` value plus side-effect rows.

### 10.1 FTF — First-Time Fix (next day claimed)
```
Schedule → Triage → PO → Receive → Service → Complete → Claim → Techpay
```
| Stage | What happens | Tables touched |
|-------|--------------|----------------|
| Schedule | CSR/dispatch books the visit | `tickets` (status), `visits` (time_slot, technician) |
| Triage | Tech diagnoses problem | `visits` (symptom_csr, cause_of_failure) |
| PO | Order required part | `parts` (status='Need PO'), `part_orders` (po_no) |
| Receive | Part arrives | `part_orders.item_status='Received'`, `part_pickups` |
| Service | Tech installs part | `visits` (repair_notes, action_type) |
| Complete | Repair done | `tickets.status='CL-Ready to Complete'`, `part_collections` (Used) |
| Claim | Submit claim to manufacturer/warranty | `tickets` (claim_company), claim record |
| Techpay | Technician paid for the job | `payroll_line_items` |

### 10.2 Reschedule — part has an ETA (next day)
```
Schedule → Triage → PO → Receive → Service → Triage with part ETA → Reschedule → (repeat from Triage)
```
- Same start, but at Service the part isn't usable/complete, so it goes back through **Triage with part ETA** and a **new visit** is created (Reschedule), looping back to Triage.
- Tables: extra `visits` rows per reschedule; `parts.eta` set; `ticket_audit_log` records each reschedule (the UI's `changedTickets` log).

### 10.3 B/O — Back Order (after claim approved)
```
Schedule → Triage → PO → Receive → Service → Triage with part ETA → B/O → Claim to Techpay
```
- Part is back-ordered, so after triage-with-ETA the ticket enters **B/O** status and waits; once the claim is approved it routes to **Claim to Techpay**.
- Tables: `part_orders.status='Back Order'`; `tickets.status='CL-Parts Back Ordered'`; on approval → `payroll_line_items`.

### 10.4 Status → flow mapping (suggested enum usage)
| Flow stage | tickets.status (REPAIR_STATUS_OPTIONS) |
|------------|----------------------------------------|
| Schedule | CSR-Needs Scheduling → OP-Ready for Service |
| Triage | TR-Need Triage |
| PO | TR-Need PO |
| Receive | OP-Waiting for Part → (received) |
| Service | OP-Ready for Service |
| Complete | CL-Ready to Complete |
| Reschedule | OP-Reschedule Follow up |
| B/O | CL-Parts Back Ordered |
| Claim | CL-Need / CL-Ready to Complete |

> Recommendation: add a `tickets.flow_type` column (`FTF` | `RESCHEDULE` | `BACKORDER`) so reports can group by path, and a `tickets.stage` column for the clean lifecycle stage (Schedule/Triage/PO/Receive/Service/Complete/Claim/Techpay) separate from the granular `status`.

```sql
alter table tickets
  add column flow_type text check (flow_type in ('FTF','RESCHEDULE','BACKORDER')),
  add column stage text check (stage in
    ('Schedule','Triage','PO','Receive','Service','Complete','Reschedule','BackOrder','Claim','Techpay'));
```

---

## 11. STRICT Company Isolation (no cross-company leaks)

**Hard rule: every piece of data — tickets, customers, visits, parts, POs, timecards, payroll, user details, audit logs — stays inside the company that owns it. Nothing leaks to another company.**

This is enforced at **three layers** so a bug in one layer can't expose data:

### Layer 1 — Schema: `company_id` on every business table (non-null)
Every tenant table already carries `company_id uuid not null references companies(id)`. Make it **NOT NULL** everywhere so a row can never exist "company-less".

```sql
-- enforce non-null company on all tenant tables (run per table)
alter table tickets        alter column company_id set not null;
alter table customers      alter column company_id set not null;
alter table visits         alter column company_id set not null;
alter table parts          alter column company_id set not null;
alter table part_orders    alter column company_id set not null;
alter table part_pickups   alter column company_id set not null;
alter table part_collections alter column company_id set not null;
alter table timecard_entries alter column company_id set not null;
alter table pto_requests   alter column company_id set not null;
alter table payroll_runs   alter column company_id set not null;
alter table payroll_line_items alter column company_id set not null;
alter table employees      alter column company_id set not null;
alter table locations      alter column company_id set not null;
-- ...repeat for every tenant table
```

### Layer 2 — RLS: deny-by-default, company-scoped policies on EVERY table
RLS is the real wall. With RLS enabled and a company-scoped policy, even a query with no `where` clause only returns the caller's company.

```sql
-- Pattern applied to EVERY tenant table (example: part_orders)
alter table part_orders enable row level security;
alter table part_orders force row level security;   -- applies even to table owner

create policy part_orders_select on part_orders
  for select using (company_id = auth_company_id() or is_superadmin());

create policy part_orders_insert on part_orders
  for insert with check (company_id = auth_company_id());   -- can't insert into another company

create policy part_orders_update on part_orders
  for update using (company_id = auth_company_id())
            with check (company_id = auth_company_id());     -- can't move a row to another company

create policy part_orders_delete on part_orders
  for delete using (company_id = auth_company_id() or is_superadmin());
```

Apply this 4-policy set (select/insert/update/delete) to: `tickets`, `customers`, `visits`, `parts`, `part_orders`, `part_pickups`, `part_collections`, `timecard_entries`, `pto_requests`, `payroll_runs`, `payroll_line_items`, `ticket_alerts`, `ticket_audit_log`, `attendance_notes`, `payroll_audit_log`, `employee_audit_log`, `salary_entries`, `employees`, `locations`, `technician_locations`, `profiles`.

> The `with check` on insert/update is what stops a malicious or buggy client from writing a row tagged with **another** company's id. The `using` on select/update/delete stops reading or touching other companies' rows.

### Layer 3 — Auto-stamp `company_id` so the client never sets it
Don't trust the client to send the right `company_id`. Stamp it server-side from the caller's profile via a trigger.

```sql
create or replace function set_company_id()
returns trigger language plpgsql as $$
begin
  -- always force the row's company to the caller's company (ignore client value)
  new.company_id := auth_company_id();
  return new;
end;
$$;

-- attach to every tenant table (example: tickets)
create trigger trg_tickets_company
  before insert on tickets
  for each row execute function set_company_id();
```
(SUPERADMIN flows that legitimately create data for a specific company should use a separate admin path / service role rather than this trigger.)

### Layer 4 — Foreign keys must be same-company (defense in depth)
A child row (e.g. a `visit`) must point at a parent (`ticket`) in the **same** company. A plain FK doesn't check that. Add a composite FK so cross-company linking is impossible at the DB level.

```sql
-- give parents a (id, company_id) unique key
alter table tickets add constraint tickets_id_company unique (id, company_id);

-- children reference BOTH id and company_id
alter table visits
  add constraint visits_ticket_same_company
  foreign key (ticket_id, company_id) references tickets(id, company_id);

alter table parts
  add constraint parts_ticket_same_company
  foreign key (ticket_id, company_id) references tickets(id, company_id);
```
Do the same for `part_orders→tickets`, `payroll_line_items→payroll_runs`, `salary_entries→employees`, etc. This guarantees Company A's visit can never attach to Company B's ticket.

### Isolation checklist (per table)
- [ ] `company_id` column exists and is `NOT NULL`
- [ ] RLS enabled **and** `force row level security`
- [ ] select/insert/update/delete policies scoped to `auth_company_id()`
- [ ] `set_company_id()` BEFORE INSERT trigger
- [ ] composite same-company FK to its parent
- [ ] index on `company_id` (or composite `(company_id, …)`) for performance

### What this guarantees for the specific items you called out
| Item | Stays in company because |
|------|--------------------------|
| Tickets | `tickets.company_id` + RLS + same-company FK to customer/location |
| User details | `profiles.company_id` + `employees.company_id` + RLS (User Management already filters by `auth.companyId`) |
| PO's | `part_orders.company_id` + RLS; child of `tickets` via same-company FK |
| Parts / pickups / collections | own `company_id` + RLS + same-company FK to ticket |
| Timecards / PTO / payroll | `employee_id` → `employees.company_id`, own `company_id` + RLS |
| Daily Schedule / Work Map | the single query in §10 includes `company_id = auth_company_id()`, and RLS enforces it even if the app forgets |
| Audit logs | own `company_id` + RLS |

**Net effect:** even if the frontend has a bug and forgets a `.eq('company_id', …)` filter, the database returns only the caller's company rows. Cross-company leakage is structurally impossible.


---

## 12. Internal Message Support / Team Messenger

Route `/m/admin/internal-message-support` (component `TeamMessenger`). A Discord-style chat with **broadcast channels**, **direct messages (DMs)**, **announcements** (only higher-ups can post), and system messages. Currently persists to localStorage key `ahs:team-messenger:v1`; this moves to Supabase so chat is shared, real-time, and company-isolated.

### Current data shapes (from `TeamMessenger.tsx`)
- `ThreadDef`: id, title, subtitle, kind (`channel` | `dm`), participant?
- `ChatMessage`: id, sender, body, createdAt, kind (`system` | `me` | `other`)
- Channels (fixed today): `#announcements`, `#all-employees`, `#general`, `#service`, `#parts`, `#admin`
- Announcement rule: only `Admin/Manager/HR/Tech Manager/Claim Manager/Part Manager/Supervisor` (HIGHER_UP_TYPES) can post to `#announcements`; announcements surface on login.

### Schema

```sql
-- ============ MESSAGE CHANNELS (broadcast threads) ============
create table message_channels (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  slug            text not null,                 -- "announcements","general","service"...
  title           text not null,                 -- "#announcements"
  subtitle        text,
  kind            text not null default 'channel'
                  check (kind in ('channel','dm')),
  is_announcement boolean not null default false, -- true → only higher-ups post
  is_system       boolean not null default false, -- seeded default channel
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  unique (company_id, slug)
);

-- ============ DIRECT MESSAGE THREADS (1:1 between two profiles) ============
create table dm_threads (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  participant_a   uuid not null references profiles(id) on delete cascade,
  participant_b   uuid not null references profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (company_id, participant_a, participant_b)
);

-- ============ MESSAGES (works for both channels and DMs) ============
create table messages (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  channel_id      uuid references message_channels(id) on delete cascade,
  dm_thread_id    uuid references dm_threads(id) on delete cascade,
  sender_id       uuid references profiles(id),  -- null = system message
  sender_name     text,                          -- denormalized display name
  body            text not null,
  kind            text not null default 'user'
                  check (kind in ('system','user')),
  is_announcement boolean not null default false,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  -- exactly one parent: a channel OR a dm thread
  constraint msg_one_parent check (
    (channel_id is not null and dm_thread_id is null) or
    (channel_id is null and dm_thread_id is not null)
  )
);

create index idx_messages_channel on messages(channel_id, created_at);
create index idx_messages_dm on messages(dm_thread_id, created_at);
create index idx_messages_company on messages(company_id);

-- ============ READ RECEIPTS / UNREAD TRACKING ============
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

-- ============ CHANNEL MEMBERSHIP (optional: private channels) ============
create table channel_members (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  channel_id      uuid not null references message_channels(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  role            text default 'member' check (role in ('member','moderator')),
  joined_at       timestamptz not null default now(),
  unique (channel_id, profile_id)
);
```

### Relationships
```
companies ──< message_channels ──< messages
          ──< dm_threads ──────────< messages
message_channels ──< channel_members >── profiles
profiles ──< messages (sender)
profiles ──< message_reads
```

### Announcement posting rule (server-enforced)
The "only higher-ups can post announcements" rule should not live only in the UI. Enforce it in the insert policy:

```sql
create policy messages_insert on messages
  for insert with check (
    company_id = auth_company_id()
    and (
      is_announcement = false
      or exists (
        select 1 from profiles p
        where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
          and p.role in ('SUPERADMIN','ADMIN','MANAGER','HR')   -- higher-ups
      )
    )
  );
```

### Company isolation (same 4-layer rule as §11)
- `company_id NOT NULL` on `message_channels`, `dm_threads`, `messages`, `message_reads`, `channel_members`.
- RLS enabled + `force row level security` + select/insert/update/delete policies scoped to `auth_company_id()`.
- `set_company_id()` BEFORE INSERT trigger on each.
- Same-company composite FKs: a `message.channel_id`/`dm_thread_id` must belong to the same company; a DM's two participants must both be in the caller's company.

```sql
-- channels/threads carry a unique (id, company_id) so messages can FK to same-company parent
alter table message_channels add constraint mc_id_company unique (id, company_id);
alter table dm_threads      add constraint dm_id_company unique (id, company_id);

alter table messages
  add constraint messages_channel_same_company
  foreign key (channel_id, company_id) references message_channels(id, company_id),
  add constraint messages_dm_same_company
  foreign key (dm_thread_id, company_id) references dm_threads(id, company_id);
```

**Result:** Company A employees can only see/join Company A channels, can only DM Company A coworkers, and announcements never cross companies. A user in one company can never message or read messages from another company.

### Migration
| Source | Target |
|--------|--------|
| Fixed `CHANNELS` array in `TeamMessenger.tsx` | seed `message_channels` per company (one set per new company) |
| localStorage `ahs:team-messenger:v1` (`{threadId: ChatMessage[]}`) | `messages` rows (channel_id or dm_thread_id resolved from threadId) |
| DM threadId `dm:{loginName}` | `dm_threads` (resolve loginName → profile) |

> **Real-time tip**: use Supabase Realtime (`supabase.channel(...).on('postgres_changes', { table: 'messages', filter: 'company_id=eq.<id>' }))`) so chat updates live. The filter plus RLS keeps the realtime stream company-scoped too.

### Add to the all-tables reference (§8)
| Table | Purpose |
|-------|---------|
| message_channels | Broadcast/team channels |
| dm_threads | 1:1 direct message threads |
| messages | Channel + DM messages |
| message_reads | Unread / read receipts |
| channel_members | Channel membership (private channels) |


---

## 13. Full Page / Module Coverage Audit

I swept every module in `src/lib/modules.ts` and every standalone route in `src/routes/`. Below is each page, the data it holds, and whether the schema already covers it. Items marked **NEW** add tables/columns in §14.

### Dashboard module
| Page (slug) | Data | Covered by |
|-------------|------|-----------|
| daily-activity | tech activity (closed/opened/miles/date) | **NEW** `daily_activity_reports` |
| overall-status | queue health rollup | derived view (no base table) |
| accounting-dashboard | attendance + payroll rollup | `timecard_entries`, `payroll_*` |
| attendance-monitoring | present/late/absent | `timecard_entries` (status) |
| payroll-calculation | payroll per employee/period | `payroll_runs`, `payroll_line_items` |
| employee-self-service | view timecards, request PTO | `timecard_entries`, `pto_requests` |
| expense-tracking | employee expenses/reimbursements | **NEW** `expenses` |
| csr-dashboard / csr-daily-report / csr-status-summary | CSR perf metrics | **NEW** `csr_activity` (+ derived) |
| call-tracker | inbound/outbound calls | **NEW** `call_logs` |
| hr-dashboard | interviews/hiring pipeline | **NEW** `hr_candidates` |

### Parts module
| Page | Data | Covered by |
|------|------|-----------|
| part-collection | used/restock reconciliation | `part_collections` |
| part-pickup | tech pickup | `part_pickups` |
| part-order | place/track orders | `part_orders` |
| part-receive | receive into inventory | **NEW** `part_receipts` |
| part-return / part-return-status | vendor returns + RA tracking | **NEW** `part_returns` |
| part-inventory | stock counts/reorder | **NEW** `part_inventory` |
| part-footprint | physical bin location | **NEW** `part_inventory` (bin column) |
| part-history | all part transactions | **NEW** `part_transactions` (ledger) |
| part-management / po-status | PO controls | `part_orders` |
| return-pickup | outbound return routing | `part_returns` |

### Tickets module
| Page | Data | Covered by |
|------|------|-----------|
| ticket-list | all tickets | `tickets` (+ customers/products) |
| new-ticket | create ticket | `tickets` |
| sms-list | SMS conversations | **NEW** `sms_messages` |
| todo-list | in-progress actions | derived from `tickets`/`visits` |
| work-planner (Daily Schedule) | schedule + map | `tickets` + `visits` (see §9) |
| work-calendar | monthly jobs | `tickets.schedule_date` |
| work-map | geo view | `tickets` + `customers` |

### Claims module
| Page | Data | Covered by |
|------|------|-----------|
| need-claim-list | tickets needing claim | derived from `tickets.status` |
| claim-list | submitted claims | **NEW** `claims` |
| authorization-status | auth requests | **NEW** `claim_authorizations` |
| claim-calendar-weekly | weekly claim activity | `claims` (+ schedule) |
| claim-planner | plan submissions | `claims` |

### Report module (HR/CSR/Claims/Triage/Parts/Operations/TX regional)
All report pages are **aggregations/rollups**, not base tables. Implement as **Postgres views** or on-demand queries over `tickets`, `visits`, `parts`, `claims`, `csr_activity`, `timecard_entries`. No new base tables required, but they all carry `company_id` through the underlying tables so they stay company-scoped.

### Admin module
| Page | Data | Covered by |
|------|------|-----------|
| user-management | users | `profiles` + `employees` |
| location-management | branches + shipping addresses | `locations` (+ **NEW** `location_addresses`) |
| account-management | external service accounts (SB/SP/GE…) for tech mapping | **NEW** `service_accounts` |
| internal-message-support | chat | `message_channels`/`dm_threads`/`messages` (§12) |
| repair-statuses | status labels + colors | **NEW** `repair_statuses` |

### Standalone routes (outside module system)
| Route | Data | Covered by |
|-------|------|-----------|
| /timecard | personal clock in/out | `timecard_entries` |
| /ticket/$ticketNo | ticket detail + audit/visit/part logs | `tickets`,`visits`,`parts`,`ticket_audit_log` (+ **NEW** `ticket_visit_log`) |
| /employee/$employeeId | HR employee detail | `employees`, `timecard_entries`, `attendance_notes` |
| /superadmin | company + admin creation | `companies`, `profiles` |
| /announcements | login announcements | `messages` where `is_announcement=true` |
| /settings | app/user settings | **NEW** `user_settings` |
| /privacy | privacy prefs | **NEW** `user_settings` (jsonb) |
| /profile | own profile, off-days, PO initials, required schedule | `employees` (+ columns already in §3.3) |
| /admin/users | legacy user mgmt | `profiles` (same as user-management) |
| /firebase-setup, /servicepower-test | dev/setup tools | no DB |

---

## 14. NEW Tables Found in the Audit

These were not in the first pass. All carry `company_id NOT NULL` + RLS + auto-stamp trigger + same-company FKs (same 4-layer rule as §11).

```sql
-- Expenses (expense-tracking dashboard)
create table expenses (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid references employees(id),
  category text check (category in ('Travel','Supplies','Meals','Other')),
  expense_date date,
  amount numeric(12,2),
  description text,
  status text default 'Pending' check (status in ('Pending','Approved','Reimbursed')),
  created_at timestamptz not null default now()
);

-- Call logs (call-tracker)
create table call_logs (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  agent_id uuid references profiles(id),
  ticket_id uuid references tickets(id) on delete set null,
  direction text check (direction in ('inbound','outbound')),
  phone_number text,
  duration_seconds int,
  outcome text,
  notes text,
  called_at timestamptz not null default now()
);

-- CSR activity (csr-dashboard / csr-daily-report / status-summary / report-csr-daily)
create table csr_activity (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  agent_id uuid references profiles(id),
  activity_date date not null,
  tasks_completed int default 0,
  scheduled int default 0,
  attempts int default 0,
  mistakes int default 0,
  status text,
  created_at timestamptz not null default now()
);

-- HR candidates (hr-dashboard / report-hr-daily)
create table hr_candidates (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  full_name text not null,
  position text,
  branch_location_id uuid references locations(id),
  stage text check (stage in ('applied','interview','offer','hired','rejected','warned','terminated')),
  interview_date date,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Daily activity reports (dashboard daily-activity)
create table daily_activity_reports (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  technician_id uuid references employees(id),
  activity_type text,
  tickets_closed int default 0,
  tickets_opened int default 0,
  miles numeric(8,1) default 0,
  report_date date not null,
  created_at timestamptz not null default now()
);

-- Part inventory + footprint
create table part_inventory (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid references locations(id),
  part_no text not null,
  description text,
  vendor text,
  bin text,
  on_hand numeric(10,2) default 0,
  reorder_point numeric(10,2) default 0,
  cost numeric(12,2) default 0,
  updated_at timestamptz not null default now(),
  unique (company_id, location_id, part_no)
);

-- Part transactions (part-history ledger: received/issued/returned/adjusted)
create table part_transactions (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  part_no text not null,
  description text,
  vendor text,
  action text check (action in ('Received','Issued','Returned','Adjusted')),
  qty numeric(10,2),
  location_id uuid references locations(id),
  ticket_id uuid references tickets(id) on delete set null,
  occurred_at timestamptz not null default now()
);

-- Part receipts (part-receive)
create table part_receipts (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  part_no text,
  description text,
  parts_from text,                    -- PARTS_FROM_OPTIONS distributor
  location_id uuid references locations(id),
  qty numeric(10,2),
  received_date date,
  received_by uuid references employees(id),
  created_at timestamptz not null default now()
);

-- Part returns + RA tracking (part-return / part-return-status / return-pickup)
create table part_returns (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  part_no text,
  description text,
  vendor text,
  reason text,
  ra_no text,
  return_type text check (return_type in ('Regular','Core')),
  status text,
  pickup_date date,
  ticket_id uuid references tickets(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Claims (claim-list / claim-calendar / claim-planner / need-claim-list)
create table claims (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  claim_no text,
  ticket_id uuid references tickets(id) on delete set null,
  brand text,                          -- GE, SQT, ASSURANT, AIG, SS
  status text,
  amount numeric(12,2),
  submitted_at timestamptz,
  scheduled_date date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (company_id, claim_no)
);

-- Claim authorizations (authorization-status)
create table claim_authorizations (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  auth_no text,
  claim_id uuid references claims(id) on delete cascade,
  ticket_id uuid references tickets(id) on delete set null,
  status text check (status in ('requested','pending','approved','denied')),
  requested_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- SMS messages (sms-list)
create table sms_messages (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  ticket_id uuid references tickets(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  direction text check (direction in ('inbound','outbound')),
  phone_number text,
  body text,
  sent_at timestamptz not null default now()
);

-- Service accounts (account-management: external SB/SP/GE accounts → tech mapping)
create table service_accounts (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  account_code text,                   -- "SB", "SP", "GE_Memphis"
  account_type text,
  technician_id uuid references employees(id),
  technician_external_id text,
  note text,
  created_at timestamptz not null default now()
);

-- Location shipping addresses (location-management)
create table location_addresses (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  label text,                          -- "Shipping", "Billing"
  address text, city text, state text, zip text,
  zoom_address text,                   -- map zoom target
  is_default boolean default false,
  created_at timestamptz not null default now()
);

-- Repair statuses (repair-statuses: labels + colors)
create table repair_statuses (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  code text not null,
  label text not null,
  color text,                          -- hex/display color
  sort_order int default 0,
  is_active boolean default true,
  unique (company_id, code)
);

-- Ticket visit log (per-ticket visit change history, route /ticket/$ticketNo)
create table ticket_visit_log (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  visit_id uuid references visits(id) on delete set null,
  action text,
  detail text,
  by_profile_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- User settings + privacy (settings / privacy pages)
create table user_settings (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  app_settings jsonb default '{}'::jsonb,
  privacy_settings jsonb default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (profile_id)
);
```

> Reports (HR/CSR/Claims/Triage/Parts/Operations/TX regional) = **views** over the tables above. Example:
> ```sql
> create view v_report_parts_daily as
> select company_id, location_id, date_trunc('day', occurred_at) as day,
>        count(*) filter (where action='Received') as received,
>        count(*) filter (where action='Returned') as returned
> from part_transactions group by 1,2,3;
> ```
> Views inherit RLS from their base tables, so they stay company-isolated automatically.

---

## 15. Does this fit with Firebase Auth? (Yes — here's exactly how)

You keep **Firebase Auth as the only login system**. Supabase is used purely as the database (no Supabase login UI). The bridge:

```
1. User logs in with Firebase (email/username + password + Company ID)   [already built]
2. Firebase returns an ID token (JWT) containing the user's uid
3. App calls a tiny backend endpoint  POST /api/supabase-token
      - verifies the Firebase ID token (firebase-admin)
      - looks up the user's company_id + role from Firestore/profiles
      - mints a Supabase-compatible JWT signed with the SUPABASE_JWT_SECRET
        claims: { sub: firebase_uid, company_id, role, exp }
4. App creates the Supabase client with that JWT in the Authorization header
5. Every query now runs as that user → RLS reads sub/company_id from the JWT
```

Why this is the clean fit:
- **No double login.** Firebase stays the single source of truth for credentials.
- **RLS still works.** The helper functions `auth_company_id()` / `is_superadmin()` in §4 read `sub` from the JWT — they don't care that the token was minted from a Firebase identity.
- **Profiles table is the link.** `profiles.firebase_uid` connects the Firebase user to their Supabase `company_id`. This table already exists in §3.1, and the field `supabaseUserId` already exists on the Firebase `UserAccount` for the reverse link.

Minimal new code:
```
api/supabase-token.ts        -- verify Firebase token → mint Supabase JWT (server-side)
src/lib/supabase/client.ts   -- create client, attach minted JWT, refresh on token change
```
Everything else (tickets, parts, payroll services) just uses that authenticated client.

> Alternative (simpler, less secure): keep RLS off and enforce `company_id` filters only in the `src/lib/supabase/*` service layer. Not recommended for production because a single missing filter leaks data. The JWT-bridge + RLS approach is the safe one and matches your "must not leak to other company" requirement.

---

## 16. Catching the User on Ticket Changes (audit "who did what")

You're right — when a ticket (or visit, part, status, schedule) changes, we must record **which user** did it. This is already modeled but here's the concrete pattern so it's consistent everywhere.

### Every mutable table records the actor
- `tickets.status_changed_by`, `visits.created_by` / `updated_by`, `parts.created_by` / `last_modified_by`, `ticket_audit_log.changed_by`, `ticket_visit_log.by_profile_id` — all FK → `profiles(id)`.

### Where the user comes from
The acting user is the JWT's `sub` (Firebase uid) → resolved to a `profiles` row. Capture it server-side so the client can't spoof it:

```sql
-- helper: current profile id from the JWT
create or replace function auth_profile_id()
returns uuid language sql stable as $$
  select id from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;
```

### Auto-write an audit row whenever a ticket's key fields change
```sql
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
  return new;
end;
$$;

create trigger trg_ticket_audit
  before update on tickets
  for each row execute function log_ticket_change();
```

This replaces the current localStorage audit (`ahs:ticket-audit:{ticketNo}`) that the Daily Schedule writes on drag-drop. Benefits:
- The actor is captured from the **authenticated identity**, not a client-supplied name → tamper-proof.
- Works no matter where the change came from (Daily Schedule drag-drop, ticket detail page, API).
- Stays company-scoped because `ticket_audit_log` has `company_id` + RLS.

Apply the same trigger pattern to `visits` (→ `ticket_visit_log`) and `parts` (→ `part_transactions`) so every visit edit and part movement also records who and when.

### Display layer
The ticket detail page's "Audit Log", the Daily Schedule's `changedTickets`, and HR's `employee_audit_log` all read from these same tables joined to `profiles` for the display name:
```sql
select a.*, p.display_name as changed_by_name
from ticket_audit_log a
left join profiles p on p.id = a.changed_by
where a.ticket_id = :ticket_id
order by a.created_at desc;
```

---

## 17. Updated Master Table List

Foundations: companies, profiles, user_settings
People/HR: employees, salary_entries, hr_candidates, attendance_notes, employee_audit_log
Locations: locations, location_addresses, technician_locations, service_accounts
Customers: customers
Tickets: tickets, visits, parts, ticket_alerts, ticket_audit_log, ticket_visit_log, sms_messages
Parts ops: part_orders, part_pickups, part_collections, part_receipts, part_returns, part_inventory, part_transactions
Claims: claims, claim_authorizations
Time/Pay: timecard_entries, pto_requests, payroll_runs, payroll_line_items, payroll_audit_log, expenses, daily_activity_reports
CSR/Calls: csr_activity, call_logs
Messaging: message_channels, dm_threads, messages, message_reads, channel_members
Config: repair_statuses
Reports: (Postgres views over the above — no base tables)

**Total: ~40 base tables, every one company-scoped.**
