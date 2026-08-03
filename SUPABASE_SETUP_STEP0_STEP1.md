# Supabase Setup — Step 0 → Step 1 (Do This In Order)

This is the hands-on checklist to get the database live. Step 0 is account/project setup (you, in the browser). Step 1 is running the schema (paste one SQL file). Nothing in the app code changes yet — that's Step 2+.

Estimated time: **15–25 minutes**.

---

## STEP 0 — Create the Supabase Project

### 0.1 Create an account
1. Go to **https://app.supabase.com**.
2. Sign in with GitHub (or email). It's free for this tier.

### 0.2 Create a new project
1. Click **New project**.
2. Fill in:
   - **Name**: `ah-solutions` (any name)
   - **Database Password**: click **Generate a password** → **copy it and save it somewhere safe** (you'll need it for backups/admin; you can't see it again later).
   - **Region**: pick the one closest to your users (e.g. `East US` for US-based).
   - **Plan**: Free.
3. Click **Create new project**. Wait ~2 minutes while it provisions (status spinner finishes).

### 0.3 Grab the three credentials
Once the project is ready:

**A) Project URL + anon key**
1. Left sidebar → **Project Settings** (gear icon) → **API**.
2. Copy **Project URL** → this is `VITE_SUPABASE_URL`.
3. Under **Project API keys**, copy the **`anon` `public`** key → this is `VITE_SUPABASE_ANON_KEY`.

**B) JWT secret (needed later for the Firebase bridge)**
1. Same **API** page → scroll to **JWT Settings**.
2. Copy **JWT Secret** → save it as `SUPABASE_JWT_SECRET`. (Used server-side in Step 2; keep it private — never put it in client code.)

### 0.4 Put the keys in `.env`
Open `darkglass-hub-suite/.env` and fill the two empty lines:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...your-anon-key...
```

Add the JWT secret too (no `VITE_` prefix so it stays server-only):
```env
SUPABASE_JWT_SECRET=your-jwt-secret-here
```

> ⚠️ Only `VITE_`-prefixed vars reach the browser. The JWT secret must **not** have `VITE_`.

### 0.5 (Optional but recommended) Install the supabase client package
Run in the project folder so the code in Step 2 has the library ready:
```bash
npm install @supabase/supabase-js
```

✅ **Step 0 done when:** the project shows "Active" in the dashboard and your `.env` has the URL + anon key filled in.

---

## STEP 1 — Create the Database Schema

You'll paste one big SQL file into Supabase's SQL editor. It creates all ~40 tables, the multi-tenant security (RLS), the auto-stamp triggers, and the audit triggers.

### 1.1 Open the SQL editor
1. In the Supabase dashboard, left sidebar → **SQL Editor**.
2. Click **+ New query**.

### 1.2 Run the migration
1. Open the file in this repo: **`supabase/migrations/0001_init.sql`**.
2. Copy the **entire** contents.
3. Paste into the Supabase SQL editor.
4. Click **Run** (or press Ctrl/Cmd + Enter).
5. Wait for **"Success. No rows returned."** That means all tables + policies were created.

> If you see an error, copy the message and we'll fix that one statement. The file is written so it can be re-run safely (it drops/creates cleanly), but normally you run it once.

### 1.3 Verify the tables exist
1. Left sidebar → **Table Editor**.
2. You should see the tables: `companies`, `profiles`, `employees`, `locations`, `customers`, `tickets`, `visits`, `parts`, `part_orders`, `timecard_entries`, `pto_requests`, `payroll_runs`, `messages`, etc.

### 1.4 Verify RLS is on
1. Left sidebar → **Authentication** → **Policies** (or Table Editor → click a table → **RLS** tab).
2. Each table should show **"RLS enabled"** with policies listed. This is what keeps companies isolated.

### 1.5 Seed your first company + link your Firebase user (so you can test later)
Run this in the SQL editor, replacing the placeholders with your real values. Your Firebase uid is the one we saw earlier: `XfKIiIgP2iXZbGbH0kZ6in5FMwa2`.

```sql
-- 1) create your company (matches your existing COMP001)
insert into companies (legacy_code, company_name, email, is_active)
values ('COMP001', 'AH Solutions', 'admin@usinhomeservices.com', true)
returning id;   -- copy the returned id

-- 2) create your profile linked to your Firebase uid + that company
insert into profiles (firebase_uid, company_id, email, username, display_name, role, is_active)
values (
  'XfKIiIgP2iXZbGbH0kZ6in5FMwa2',            -- your Firebase uid
  '<paste-company-id-from-step-1>',          -- the id returned above
  'jhon.r@usinhomeservices.com',
  'Jhon.Rulona',
  'Jhon Rulona',
  'ADMIN',
  true
);
```

> Tip: instead of copy-pasting the id, you can do it in one shot:
> ```sql
> insert into profiles (firebase_uid, company_id, email, username, display_name, role, is_active)
> select 'XfKIiIgP2iXZbGbH0kZ6in5FMwa2',
>        c.id, 'jhon.r@usinhomeservices.com', 'Jhon.Rulona', 'Jhon Rulona', 'ADMIN', true
> from companies c where c.legacy_code = 'COMP001';
> ```

✅ **Step 1 done when:** all tables appear in the Table Editor, RLS shows enabled, and your `companies` + `profiles` rows exist.

---

## What happens after (preview of Step 2)
- I add `src/lib/supabase/client.ts` and the `api/supabase-token.ts` bridge (verifies your Firebase login → mints a Supabase token carrying your `company_id`).
- We test that a logged-in user reads back only their company's rows.
- Then we migrate User Management, then Tickets, etc., deleting dummy data per domain.

You don't need to do anything for Step 2 except have Step 0 + 1 finished. Ping me once the migration runs clean and your two rows exist.

---

## Quick troubleshooting
| Symptom | Fix |
|--------|-----|
| `extension "uuid-ossp" does not exist` | The migration's first line enables it; make sure you pasted the whole file from the top. |
| `permission denied` running SQL | You must run it as the project owner in the dashboard SQL editor (you are, by default). |
| Tables created but RLS "disabled" | Re-run the RLS section at the bottom of the migration; ensure no statement errored midway. |
| Can't find JWT secret | Project Settings → API → **JWT Settings** → **JWT Secret** (not the anon key). |
| `.env` changes not picked up | Restart the dev server (`npm run dev`) after editing `.env`. |
