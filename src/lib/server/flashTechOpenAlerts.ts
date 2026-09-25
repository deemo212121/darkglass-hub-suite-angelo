/**
 * Hourly Cron Trigger job (see scheduled() in src/server.ts): email a
 * company's configured recipient the moment a Flash Tech trip's status
 * auto-flips from Upcoming to Open (its travel start date has arrived —
 * see computeFlashTechTripStatus's doc comment in flashTechTrips.ts,
 * reimplemented locally below since that file pulls in the browser
 * Supabase client, which can't run in the Worker — same reasoning
 * attendanceAlerts.ts's own header comment gives for its local
 * resolveManagerId). Mirrors attendanceAlerts.ts's overall shape: raw
 * REST + service key, per-item try/catch, a plain summary object.
 *
 * "Today" for this whole job is America/Chicago local time (see
 * chicagoDateIso below), not UTC — matching the same local-midnight
 * convention the rest of the app uses for day boundaries
 * (technicianForcedCheckout.ts, passwordResetSchedule.ts) and the exact
 * instant flashTechTrips.ts's own computeFlashTechTripStatus flips a trip's
 * displayed status at, so the email and the on-screen status change
 * together rather than drifting by several hours.
 *
 * Detecting the transition: flash_tech_trips.status is NOT used as the
 * signal (deliberately) — it's the LAST value actually written (at
 * creation or any date edit), and any ordinary edit re-saves it fresh off
 * today's real date, independent of whether this job has processed the
 * transition yet. The stable signal instead is: was this trip's start date
 * still in the future at the moment it was CREATED (start_date >
 * created_at, which nothing else ever touches)? Every trip with
 * open_alert_sent_at IS NULL is a candidate, checked on every hourly run
 * until it resolves one way or the other:
 *   - created with a future start date, and freshly computes to "Open" now
 *     -> genuine transition: email, then persist status="Open" and stamp
 *     open_alert_sent_at.
 *   - fresh "Open" but start date wasn't in the future at creation (e.g.
 *     created with today's start date, never actually Upcoming) -> stamp
 *     open_alert_sent_at with no email; there was no transition to report.
 *   - fresh "Closed"/"Cancelled", or a manual status_override is set
 *     -> stamp open_alert_sent_at with no email; no longer relevant.
 *   - fresh still "Upcoming" -> leave open_alert_sent_at null, re-check
 *     next run.
 * This keeps the open_alert_sent_at IS NULL candidate set bounded to only
 * genuinely-still-pending trips instead of growing forever.
 *
 * Silently does nothing for a company with no FLASH_TECH Gmail connected,
 * or no recipient address configured (migration 0267/0268,
 * companySettings.ts's getFlashTechOpenAlertEmail) — same tolerance
 * attendanceAlerts.ts's grace-warning emails already have for "nothing to
 * send to".
 */

import { readEnv, fetchGmailConnection, refreshAccessToken, sendGmailMessage } from "./gmailBridge";

interface AlertSummary {
  tripsChecked: number;
  emailsSent: number;
  markedNoAlertNeeded: number;
  errors: string[];
  /** One line per checked trip explaining what happened to it — always
   *  populated (not just on dryRun) so "0 sent" is never a dead end; the
   *  UI can show exactly why each trip didn't qualify instead of a bare
   *  count. */
  details: Array<{ tripId: string; technicianName: string; outcome: string }>;
}

interface ServerTrip {
  id: string;
  company_id: string;
  technician_name: string;
  origin_location: string;
  destination_location: string;
  start_date: string;
  end_date: string;
  status: string | null;
  status_override: string | null;
  hotel_name: string | null;
  lodging_start_date: string | null;
  lodging_end_date: string | null;
  hotel_address: string | null;
  created_at: string;
}

function resolveCreds(env: Record<string, string | undefined>) {
  const g = globalThis as any;
  const supabaseUrl =
    (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ?? env.VITE_SUPABASE_URL;
  const supabaseServiceKey =
    (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ??
    env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, supabaseServiceKey };
}

/** Same Upcoming/Open/Closed rule as computeFlashTechTripStatus in flashTechTrips.ts — kept in sync by hand since that file can't be imported here. */
function computeStatus(startDate: string, endDate: string, todayIso: string): "Upcoming" | "Open" | "Closed" {
  if (endDate < todayIso) return "Closed";
  if (startDate > todayIso) return "Upcoming";
  return "Open";
}

/**
 * "Today" in America/Chicago (CST/CDT, DST-aware) — same helper/reasoning as
 * flashTechTrips.ts's own copy (kept in sync by hand, same reason this whole
 * file duplicates computeStatus instead of importing it): this job's
 * real-run day boundary must land on the same instant the UI's own status
 * display flips at, not UTC midnight, or the two would drift by several
 * hours and an admin would see "Open" on screen long before the alert
 * actually fires (or vice versa).
 */
function chicagoDateIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

export async function runFlashTechOpenAlertCheck(
  env: Record<string, string | undefined>,
  opts: { dryRun?: boolean; asOfIso?: string; simulate?: boolean; explain?: boolean } = {}
): Promise<AlertSummary> {
  const summary: AlertSummary = { tripsChecked: 0, emailsSent: 0, markedNoAlertNeeded: 0, errors: [], details: [] };
  const { supabaseUrl, supabaseServiceKey } = resolveCreds(env);
  if (!supabaseUrl || !supabaseServiceKey) {
    summary.errors.push("Missing Supabase URL/service key — cannot run.");
    return summary;
  }
  const sbHeaders = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    "Content-Type": "application/json",
  };

  // `asOfIso` lets a tester pretend "today" is a future date — e.g. to prove
  // a trip scheduled to start tomorrow would actually trigger an email,
  // without waiting for real midnight. `simulate` (forced on whenever
  // asOfIso is set from the client — see handleRunFlashTechOpenAlertsRequest
  // below) sends REAL emails so the Gmail send path is genuinely exercised,
  // but skips every database write, so the real trip's status/
  // open_alert_sent_at are untouched and the genuine automatic alert still
  // fires normally once that date actually arrives.
  const todayIso = opts.asOfIso || chicagoDateIso();
  const simulate = Boolean(opts.simulate && opts.asOfIso);

  // The real run only ever looks at trips it hasn't stamped "handled" yet —
  // that's what keeps its candidate set bounded (see header comment). A
  // simulated test has a narrower, more literal job: "pretend today is the
  // date I picked — which trip(s) actually START on that day, and would
  // they alert?" So it scopes straight to start_date === the chosen test
  // date, instead of every still-open/ongoing trip in the table (which would
  // otherwise re-flag trips that started long before the picked date on
  // every test run — noisy and not what a tester picking one date means).
  // Ignores open_alert_sent_at entirely, same reasoning as before: simulate
  // mode never writes it either way (guarded further below), so it's safe
  // to look at a trip regardless of whether it's already been stamped.
  const candidateFilter = simulate ? `&start_date=eq.${todayIso}` : "&open_alert_sent_at=is.null";
  const tripsRes = await fetch(
    `${supabaseUrl}/rest/v1/flash_tech_trips?select=id,company_id,technician_name,origin_location,destination_location,start_date,end_date,status,status_override,hotel_name,lodging_start_date,lodging_end_date,hotel_address,created_at${candidateFilter}`,
    { headers: sbHeaders }
  );
  if (!tripsRes.ok) {
    summary.errors.push(`Failed to list trips: HTTP ${tripsRes.status}`);
    return summary;
  }
  const trips: ServerTrip[] = await tripsRes.json();
  summary.tripsChecked = trips.length;

  // Diagnostic-only (manual test runs, not the real hourly cron) — trips
  // ALREADY marked open_alert_sent_at from an earlier run are invisible to
  // the query above by design (that's what keeps the candidate set
  // bounded), which otherwise makes "why isn't trip X showing up at all"
  // impossible to answer without a raw SQL query. Explains, never
  // reprocesses — doesn't touch tripsChecked/emailsSent or toEmail/toMarkOnly.
  if (opts.explain && !simulate) {
    const handledRes = await fetch(
      `${supabaseUrl}/rest/v1/flash_tech_trips?select=id,technician_name,status,status_override,open_alert_sent_at&open_alert_sent_at=not.is.null&order=open_alert_sent_at.desc&limit=50`,
      { headers: sbHeaders }
    );
    if (handledRes.ok) {
      const handled: Array<{ id: string; technician_name: string; status: string; status_override: string | null; open_alert_sent_at: string }> =
        await handledRes.json();
      for (const t of handled) {
        summary.details.push({
          tripId: t.id,
          technicianName: t.technician_name,
          outcome: t.status_override
            ? `Already excluded — manual status override "${t.status_override}" set (Tracker's Status dropdown), marked handled ${t.open_alert_sent_at}.`
            : `Already excluded — marked handled ${t.open_alert_sent_at} (no transition was due at that time, or was already sent).`,
        });
      }
    }
  }

  if (trips.length === 0) return summary;

  const toEmail: ServerTrip[] = [];
  const toMarkOnly: ServerTrip[] = [];
  for (const t of trips) {
    if (t.status_override) {
      toMarkOnly.push(t);
      summary.details.push({
        tripId: t.id,
        technicianName: t.technician_name,
        outcome: `Skipped — manual status override set to "${t.status_override}" (Tracker's Status dropdown), so this trip is never auto-checked against its dates again until the override is changed.`,
      });
      continue;
    }
    const fresh = computeStatus(t.start_date, t.end_date, todayIso);
    // Was this trip genuinely scheduled for the future when it was created —
    // i.e. did it actually start life as "Upcoming"? Deliberately NOT based
    // on the current `status` column: any ordinary Tracker edit (a hotel
    // rate, a note, anything) re-saves the trip and recomputes `status`
    // fresh off today's REAL date, which silently overwrites "Upcoming" the
    // moment the real transition happens — even before this job's next run
    // sees it. Relying on that column meant a routine edit landing in the
    // same window as the real transition could permanently erase the one
    // signal this job needs, and the alert would just never fire. created_at
    // vs. start_date isn't touched by unrelated edits, so it survives.
    const wasScheduledForFuture = t.start_date > t.created_at.slice(0, 10);
    if (fresh === "Open" && wasScheduledForFuture) {
      toEmail.push(t);
      summary.details.push({ tripId: t.id, technicianName: t.technician_name, outcome: `Will email — scheduled for the future at creation, now "${fresh}" as of ${todayIso}.` });
    } else if (fresh !== "Upcoming") {
      toMarkOnly.push(t);
      summary.details.push({
        tripId: t.id,
        technicianName: t.technician_name,
        outcome: wasScheduledForFuture
          ? `No email — computes to "${fresh}" but this isn't the Upcoming->Open crossing (e.g. already Closed).`
          : `No email — created already "${fresh}" or earlier (start date wasn't in the future at creation), so there was never an Upcoming->Open transition to report.`,
      });
    } else {
      summary.details.push({ tripId: t.id, technicianName: t.technician_name, outcome: `Still "Upcoming" as of ${todayIso} — not due yet, will re-check next run.` });
    }
  }

  if (opts.dryRun) {
    summary.emailsSent = toEmail.length;
    summary.markedNoAlertNeeded = toMarkOnly.length;
    return summary;
  }

  // Trips needing no email — just stamp them so future runs skip them.
  // Skipped entirely in simulate mode — a simulated future date would
  // otherwise permanently mark a still-genuinely-Upcoming trip as handled.
  if (!simulate) {
    for (const t of toMarkOnly) {
      try {
        await fetch(`${supabaseUrl}/rest/v1/flash_tech_trips?id=eq.${t.id}`, {
          method: "PATCH",
          headers: sbHeaders,
          body: JSON.stringify({ open_alert_sent_at: new Date().toISOString() }),
        });
      } catch (e) {
        summary.errors.push(`Mark ${t.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (toEmail.length === 0) return summary;

  const envResult = readEnv(env);
  if ("error" in envResult) {
    summary.errors.push(`Open-trip emails skipped: ${envResult.error}`);
    return summary;
  }
  const gmailEnv = envResult;

  // Group by company — one connection lookup + one settings read per
  // company involved, not per trip.
  const byCompany = new Map<string, ServerTrip[]>();
  for (const t of toEmail) {
    if (!byCompany.has(t.company_id)) byCompany.set(t.company_id, []);
    byCompany.get(t.company_id)!.push(t);
  }

  for (const [companyId, companyTrips] of byCompany) {
    try {
      const [connection, settingsRes] = await Promise.all([
        fetchGmailConnection(gmailEnv, companyId, "FLASH_TECH"),
        fetch(`${supabaseUrl}/rest/v1/companies?id=eq.${companyId}&select=settings`, { headers: sbHeaders }),
      ]);
      if (!connection) continue; // FLASH_TECH Gmail not connected for this company — trips stay un-stamped, retried next run
      const settingsRows = settingsRes.ok ? await settingsRes.json() : [];
      const recipientRaw = (settingsRows?.[0]?.settings?.flashTechOpenAlertEmail as string | undefined) || "";
      const recipients = recipientRaw.split(",").map((s) => s.trim()).filter(Boolean);
      if (recipients.length === 0) continue; // no recipient configured — trips stay un-stamped, retried next run

      const accessToken = await refreshAccessToken(gmailEnv, connection.refreshToken);
      const fromEmail = connection.connectedEmail || "me";

      for (const t of companyTrips) {
        const subjectPrefix = simulate ? "[TEST] " : "";
        const subject = `${subjectPrefix}Flash Tech trip now Open — ${t.technician_name}`;
        const lodgingDates =
          t.lodging_start_date || t.lodging_end_date ? `${t.lodging_start_date || "?"} – ${t.lodging_end_date || "?"}` : null;
        const bodyLines = [
          simulate ? `(Simulated as of ${todayIso} — no real data was changed by this test.)\n` : "",
          `${t.technician_name}'s Flash Tech trip is now Open — the travel start date has arrived.`,
          "",
          `Route: ${t.origin_location} → ${t.destination_location}`,
          `Travel dates: ${t.start_date} – ${t.end_date}`,
        ];
        // Hotel details are Tracker-filled-in-later fields — only shown when
        // actually on file yet, rather than printing empty placeholders.
        if (t.hotel_name) bodyLines.push(`Hotel Name: ${t.hotel_name}`);
        if (lodgingDates) bodyLines.push(`Lodging Date: ${lodgingDates}`);
        if (t.hotel_address) bodyLines.push(`Address: ${t.hotel_address}`);
        const body = bodyLines.join("\n");
        try {
          const [firstRecipient, ...rest] = recipients;
          await sendGmailMessage(accessToken, fromEmail, firstRecipient, subject, body, rest.join(",") || undefined);
          if (!simulate) {
            await fetch(`${supabaseUrl}/rest/v1/flash_tech_trips?id=eq.${t.id}`, {
              method: "PATCH",
              headers: sbHeaders,
              body: JSON.stringify({ status: "Open", open_alert_sent_at: new Date().toISOString() }),
            });
          }
          summary.emailsSent++;
        } catch (e) {
          summary.errors.push(`Trip ${t.id} (${t.technician_name}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      summary.errors.push(`Company ${companyId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  summary.markedNoAlertNeeded = toMarkOnly.length;
  return summary;
}

// Manual "Run Now" trigger — same reasoning as attendanceAlerts.ts's own
// handleRunAttendanceAlertsRequest: `vite dev` runs no Workers runtime, so
// there's no way to exercise the hourly cron locally without this. A REAL
// run (writes real open_alert_sent_at stamps, sends real emails), not a
// sandboxed test path. Admin/SuperAdmin/HR only.
export async function handleRunFlashTechOpenAlertsRequest(request: Request, env: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
    if (!idToken) return json({ error: "Missing idToken" }, 400);

    const envResult = readEnv(env);
    if ("error" in envResult) return json(envResult, 500);

    const { verifyFirebaseToken } = await import("./supabaseTokenBridge");
    const { fetchProfileByFirebaseUid } = await import("./gmailBridge");
    const claims = await verifyFirebaseToken(idToken, envResult.firebaseProjectId);
    const caller = await fetchProfileByFirebaseUid(envResult, claims.sub);
    if (!caller) return json({ error: "Profile not found" }, 403);
    const callerRoles = [caller.role, ...caller.extraRoles].map((r) => (r || "").toUpperCase());
    const canRun = callerRoles.some((r) => r === "ADMIN" || r === "SUPERADMIN" || r === "HR");
    if (!canRun) return json({ error: "Only HR/Admin can run this" }, 403);

    const dryRun = payload.dryRun === true;
    const asOfIso = typeof payload.asOfIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.asOfIso) ? payload.asOfIso : undefined;
    // simulate is always forced true whenever a caller passes asOfIso — a
    // fake "today" must never be allowed to write real status/
    // open_alert_sent_at values (see runFlashTechOpenAlertCheck's own
    // comment on why that would break the trip's real future alert).
    const result = await runFlashTechOpenAlertCheck(env, { dryRun, asOfIso, simulate: Boolean(asOfIso), explain: true });
    return json({ ok: true, result });
  } catch (err) {
    console.error("[flashTechOpenAlerts] manual run error:", err);
    return json({ error: err instanceof Error ? err.message : "Run failed" }, 500);
  }
}
