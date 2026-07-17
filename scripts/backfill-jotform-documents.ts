/**
 * Jotform Documents backfill
 * --------------------------
 * One-time import of every submission Jotform still has on file (across
 * every form in the account) into hr_jotform_submissions — for submissions
 * that predate the live webhook (src/lib/server/jotformBridge.ts), or that
 * came in before this feature existed. Reuses the exact same logic the live
 * webhook uses (fetchJotformGeneratedPdf, uploadFileToStorage,
 * extractApplicantNameFromApiAnswers, upsertJotformSubmissionRow) so a
 * backfilled row is indistinguishable from one the webhook wrote live.
 *
 * Safe to re-run: skips any submission_id already present in Supabase for
 * this company, so partial runs / interruptions just pick up where they
 * left off.
 *
 * Cannot recover submissions already deleted from Jotform — this only
 * reads whatever Jotform's API still has on file right now.
 *
 * Run once:
 *   npx tsx scripts/backfill-jotform-documents.ts
 *
 * Requires (reads from .env, same names the app already uses):
 *   JOTFORM_API_KEY, JOTFORM_TARGET_COMPANY_ID, VITE_SUPABASE_URL,
 *   SUPABASE_SERVICE_KEY, VITE_FIREBASE_STORAGE_BUCKET,
 *   FIREBASE_SERVICE_ACCOUNT_EMAIL, FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
 */

// ── Load .env from project root ──────────────────────────────────────────
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
try {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip a matching pair of wrapping quotes — e.g. FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN...-----\n...\n" — otherwise the literal quote character ends up inside the value.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not found — rely on process.env being set externally
}
// ─────────────────────────────────────────────────────────────────────────

import {
  getGoogleAccessToken,
  fetchJotformGeneratedPdf,
  fetchJotformSubmissionAnswers,
  extractApplicantNameFromApiAnswers,
  uploadFileToStorage,
  upsertJotformSubmissionRow,
} from "../src/lib/server/jotformBridge";

// Test/junk forms — never imported, even on a re-run.
const EXCLUDED_FORM_TITLES = new Set(["TESTING", "ahs testing form", "Customer Feedback Form"]);

const JOTFORM_API_KEY = process.env.JOTFORM_API_KEY || "";
const COMPANY_ID = process.env.JOTFORM_TARGET_COMPANY_ID || "";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const STORAGE_BUCKET = process.env.VITE_FIREBASE_STORAGE_BUCKET || "";
const FIREBASE_SA_EMAIL = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL || "";
const FIREBASE_SA_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || "";

// Be polite to Jotform's API — a few requests per submission (submission
// fetch, generatePDF, possibly form-questions) adds up fast across 25 forms.
// 400ms wasn't enough — a real run hit 429 "API-Limit exceeded" partway
// through, including on the whole-form submissions listing (not just
// per-submission calls), so this needs real backoff, not just a delay bump.
const DELAY_MS = 800;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries on a 429 (rate limit) with increasing backoff — anything else rethrows immediately. */
async function withRetry429<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const backoffsMs = [3000, 8000, 20000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err instanceof Error && /\b429\b/.test(err.message);
      if (!is429 || attempt >= backoffsMs.length) throw err;
      const wait = backoffsMs[attempt];
      console.log(`  … rate limited on ${label}, waiting ${wait / 1000}s before retry ${attempt + 1}/${backoffsMs.length}`);
      await delay(wait);
    }
  }
}

function assertConfig() {
  const missing = [
    !JOTFORM_API_KEY && "JOTFORM_API_KEY",
    !COMPANY_ID && "JOTFORM_TARGET_COMPANY_ID",
    !SUPABASE_URL && "VITE_SUPABASE_URL",
    !SUPABASE_SERVICE_KEY && "SUPABASE_SERVICE_KEY",
    !STORAGE_BUCKET && "VITE_FIREBASE_STORAGE_BUCKET",
    !FIREBASE_SA_EMAIL && "FIREBASE_SERVICE_ACCOUNT_EMAIL",
    !FIREBASE_SA_KEY && "FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Missing required .env values: ${missing.join(", ")}`);
    process.exit(1);
  }
}

interface JotformForm {
  id: string;
  title: string;
}

async function fetchAllForms(): Promise<JotformForm[]> {
  const forms: JotformForm[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const res = await fetch(`https://api.jotform.com/user/forms?apiKey=${JOTFORM_API_KEY}&limit=${limit}&offset=${offset}`);
    if (!res.ok) throw new Error(`Fetching forms failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { content?: Array<{ id: string; title: string }> };
    const page = body.content ?? [];
    forms.push(...page.map((f) => ({ id: f.id, title: f.title })));
    if (page.length < limit) break;
    offset += limit;
    await delay(DELAY_MS);
  }
  return forms;
}

interface JotformSubmissionSummary {
  id: string;
  created_at: string;
}

async function fetchAllSubmissionsForForm(formId: string): Promise<JotformSubmissionSummary[]> {
  const submissions: JotformSubmissionSummary[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const res = await fetch(`https://api.jotform.com/form/${formId}/submissions?apiKey=${JOTFORM_API_KEY}&limit=${limit}&offset=${offset}`);
    if (!res.ok) throw new Error(`Fetching submissions for form ${formId} failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { content?: Array<{ id: string; created_at: string }> };
    const page = body.content ?? [];
    submissions.push(...page.map((s) => ({ id: s.id, created_at: s.created_at })));
    if (page.length < limit) break;
    offset += limit;
    await delay(DELAY_MS);
  }
  return submissions;
}

/** True if this submission is already recorded — lets the script be safely re-run. */
async function alreadyImported(submissionId: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/hr_jotform_submissions?select=id&company_id=eq.${COMPANY_ID}&submission_id=eq.${encodeURIComponent(submissionId)}`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!res.ok) throw new Error(`Checking existing submission failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

async function main() {
  assertConfig();

  console.log("Fetching your Jotform account's forms…");
  // Optional cap on how many NEW submissions to actually process this run —
  // e.g. `npx tsx scripts/backfill-jotform-documents.ts 5` to try just 5
  // before committing to the full backlog. Already-imported submissions are
  // skipped for free and don't count against this limit.
  const limitArg = Number(process.argv[2]);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : Infinity;
  if (limit !== Infinity) console.log(`Limiting this run to ${limit} new submission(s).`);

  const allForms = await withRetry429(() => fetchAllForms(), "listing forms");
  const forms = allForms.filter((f) => !EXCLUDED_FORM_TITLES.has(f.title));
  console.log(`Found ${allForms.length} form(s), ${forms.length} after excluding: ${[...EXCLUDED_FORM_TITLES].join(", ")}.`);

  // Fetched once per submission rather than once for the whole run —
  // getGoogleAccessToken caches internally and returns instantly while the
  // token's still valid, but a run covering ~2000 submissions easily
  // outlasts the token's ~1hr TTL if fetched only once up front (that's
  // exactly what caused a wave of "Invalid Credentials" 401s partway
  // through the first attempt at this).

  let imported = 0;
  let skippedExisting = 0;
  let skippedNoDocument = 0;
  let failed = 0;

  formsLoop: for (const form of forms) {
    console.log(`\n── ${form.title} (${form.id}) ──`);
    let submissions: JotformSubmissionSummary[];
    try {
      submissions = await withRetry429(() => fetchAllSubmissionsForForm(form.id), `listing submissions for ${form.title}`);
    } catch (err) {
      console.error(`  Failed to list submissions:`, err);
      continue;
    }
    console.log(`  ${submissions.length} submission(s) found.`);

    for (const sub of submissions) {
      if (imported >= limit) break formsLoop;
      try {
        // Checked against Supabase, not Jotform — free to do at full speed,
        // no reason to burn the rate-limit delay on submissions we're not
        // even going to call Jotform's API for.
        if (await alreadyImported(sub.id)) {
          skippedExisting++;
          continue;
        }

        await delay(DELAY_MS);
        const answers = await withRetry429(() => fetchJotformSubmissionAnswers(sub.id, JOTFORM_API_KEY), `answers for ${sub.id}`);
        const applicantName = (await extractApplicantNameFromApiAnswers(answers, form.id, JOTFORM_API_KEY)) || "Someone";

        // Note: fetchJotformGeneratedPdf swallows its own errors internally
        // (returns null rather than throwing, by design — the live webhook
        // never blocks on a document fetch failing) so it can't be retried
        // here the same way; a transient 429 on this specific call gets
        // recorded as "no document" rather than retried. Rare in practice —
        // the observed failures were all in submission listing/answers, not
        // this call — but worth rerunning once more afterward if the
        // "no fetchable document" count looks high.
        const pdf = await fetchJotformGeneratedPdf(form.id, sub.id, JOTFORM_API_KEY);
        let documentUrl: string | null = null;
        let documentPath: string | null = null;
        if (pdf) {
          documentPath = `companies/${COMPANY_ID}/jotform-documents/${form.id}/${sub.id}.pdf`;
          const accessToken = await getGoogleAccessToken(FIREBASE_SA_EMAIL, FIREBASE_SA_KEY);
          documentUrl = await uploadFileToStorage(STORAGE_BUCKET, accessToken, documentPath, pdf.contentType, pdf.bytes);
        } else {
          skippedNoDocument++;
        }

        const submittedAt = new Date(sub.created_at.replace(" ", "T")).toISOString();
        await upsertJotformSubmissionRow(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          companyId: COMPANY_ID,
          formId: form.id,
          formTitle: form.title,
          submissionId: sub.id,
          applicantName,
          documentUrl,
          documentPath,
          submittedAt,
        });

        imported++;
        console.log(`  ✓ ${sub.id} — ${applicantName}${documentUrl ? "" : " (no document)"}`);
      } catch (err) {
        failed++;
        console.error(`  ✗ ${sub.id} failed:`, err);
      }
    }
  }

  console.log(`\nDone. Imported ${imported}, skipped ${skippedExisting} already-existing, ${skippedNoDocument} had no fetchable document, ${failed} failed.`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
