/**
 * Trainee decisions (see src/lib/traineeDecision.ts for who's asked, when,
 * and by whom) — the server half:
 *
 *  - runTraineeDecisionPrompts: hourly (scheduled() in src/server.ts). Each
 *    trainee whose checkpoint has arrived gets one 'asked' row per checkpoint
 *    (hr_trainee_decisions, migration 0407 — unique, ignore-duplicates), and
 *    only a NEWLY inserted row notifies: one batched notification per manager
 *    ("/home?traineeDecision=open" opens the popup). A trainee with no
 *    manager on file goes to HR instead.
 *
 *  - POST /api/trainee-decision { idToken, action: "queue" }
 *      → { items }  the trainees waiting on the caller's answer
 *    POST /api/trainee-decision { idToken, action: "decide", key, choice, date, note }
 *      choice "hire"    date = Field Start (first day on their own) — Hiring
 *                       status Hired with that Start Date, Field Start set,
 *                       Regular now if the date has arrived; the Hiring tab's
 *                       🎉 hire notification
 *             "extend"  date = last training day (tomorrow or later) — Field
 *                       Start moves to the day after; back to Trainee if the
 *                       Field Start switch already made them Regular
 *             "let_go"  date = last day, note = reason (required) — exactly
 *                       Training List's Quit/Stopped: Hiring status Withdrawn,
 *                       account deactivated, Master List Inactive / Terminate
 *      HR is notified of every answer. Only the trainee's manager, or Admin /
 *      Super Admin / HR, can answer — the caller comes from the verified
 *      Firebase token, never the body.
 *
 * Service key throughout: a Branch Manager can't edit another person's
 * profile (profiles_update, migrations 0150/0206).
 */
import { verifyFirebaseToken } from "./supabaseTokenBridge";
import { DEFAULT_ATTENDANCE_TIMEZONE, nowInTimezone } from "../attendanceGrace";
import { HIRE_NOTIFICATION_EXTRA_RECIPIENT_IDS } from "../hireNotificationRecipients";
import {
  addDaysISO,
  buildTraineeDecisionQueue,
  type DecisionCandidateRow,
  type DecisionProfileRow,
  type TraineeDecisionChoice,
  type TraineeDecisionItem,
  type TraineeDecisionRow,
} from "../traineeDecision";

const PROMPT_LINK = "/home?traineeDecision=open";
const TRAINING_LIST_LINK = "/m/hr/training-list";
const HR_ADMIN_ROLES = new Set(["ADMIN", "SUPERADMIN", "HR"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Rest = {
  url: string;
  headers: Record<string, string>;
  get: <T>(path: string) => Promise<T[]>;
  send: (method: string, path: string, body: unknown, prefer?: string) => Promise<Response>;
};

function makeRest(env: Record<string, string | undefined>): Rest | { error: string } {
  const g = globalThis as any;
  const url = (g.__SUPABASE_URL__ || undefined) ?? env.VITE_SUPABASE_URL;
  const key = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { error: "Missing Supabase URL/service key." };
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  return {
    url,
    headers,
    // Paged — profiles can run past PostgREST's 1,000-row cap.
    get: async <T,>(path: string) => {
      const out: T[] = [];
      for (let from = 0; ; from += 1000) {
        const res = await fetch(`${url}/rest/v1/${path}`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
        if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status} ${await res.text()}`);
        const rows = (await res.json()) as T[];
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    },
    send: (method, path, body, prefer = "return=minimal") =>
      fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, Prefer: prefer }, body: JSON.stringify(body) }),
  };
}

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";

async function loadQueue(rest: Rest, today: string, companyId?: string): Promise<TraineeDecisionItem[]> {
  const scope = companyId ? `&company_id=eq.${companyId}` : "";
  const [candidates, profiles, decisions] = await Promise.all([
    rest.get<DecisionCandidateRow>(
      `hr_candidates?select=id,company_id,full_name,phone,email,position,branch,status,training_start_date,training_end_date,branch_manager_id,assigned_manager_id,trainer_id&status=eq.training${scope}&order=id`,
    ),
    rest.get<DecisionProfileRow>(
      `profiles?select=id,company_id,display_name,email,phone_number,role,is_active,employment_type,manager_name,assigned_branch,training_end_date,hire_date:employee_info->>hireDate,terminate_date:employee_info->>terminateDate${scope}&order=id`,
    ),
    rest.get<TraineeDecisionRow>(`hr_trainee_decisions?select=trainee_key,due_date,decision,decision_date,created_at${scope}&order=id`),
  ]);
  return buildTraineeDecisionQueue(candidates, profiles, decisions, today);
}

/** Migration 0407 not run yet — nothing to ask or record. */
const isMissingTable = (e: unknown) => /hr_trainee_decisions: HTTP 404|42P01|PGRST205/.test(String(e));

async function notify(rest: Rest, rows: { company_id: string; recipient_id: string; sender_id: string | null; sender_name: string; body: string; link_to: string }[]) {
  if (rows.length === 0) return 0;
  const res = await rest.send("POST", "notifications", rows);
  if (!res.ok) throw new Error(`notifications: HTTP ${res.status} ${await res.text()}`);
  return rows.length;
}

async function hrRecipientIds(rest: Rest, companyId: string): Promise<string[]> {
  const rows = await rest.get<{ id: string }>(`profiles?select=id&company_id=eq.${companyId}&is_active=eq.true&or=(role.eq.HR,extra_roles.cs.%7BHR%7D)`);
  return rows.map((r) => r.id);
}

// ───────────────────────────────────────────────────────────────────────
// Hourly ask
// ───────────────────────────────────────────────────────────────────────

interface PromptSummary {
  today: string;
  due: number;
  newlyAsked: string[];
  notificationsSent: number;
  errors: string[];
}

const askLine = (i: TraineeDecisionItem, today: string) => {
  const who = `${i.name}${i.branch ? ` (${i.branch})` : ""}`;
  if (i.reason === "two_weeks") return `${who} — 2 weeks of training (since ${fmt(i.startDate)})`;
  if (i.dueDate === today) return `${who} — last training day today, Field Start ${fmt(i.fieldStart)}`;
  return `${who} — training ended ${fmt(i.dueDate)}`;
};

export async function runTraineeDecisionPrompts(env: Record<string, string | undefined>): Promise<PromptSummary> {
  const today = nowInTimezone(DEFAULT_ATTENDANCE_TIMEZONE).dateISO;
  const summary: PromptSummary = { today, due: 0, newlyAsked: [], notificationsSent: 0, errors: [] };
  const rest = makeRest(env);
  if ("error" in rest) {
    summary.errors.push(rest.error);
    return summary;
  }

  let queue: TraineeDecisionItem[];
  try {
    queue = await loadQueue(rest, today);
  } catch (e) {
    summary.errors.push(isMissingTable(e) ? "hr_trainee_decisions doesn't exist yet — run migration 0407." : e instanceof Error ? e.message : String(e));
    return summary;
  }
  summary.due = queue.length;
  const toManager = new Map<string, { companyId: string; lines: string[] }>();
  const unassigned = new Map<string, string[]>();
  for (const item of queue) {
    const res = await rest.send(
      "POST",
      "hr_trainee_decisions?on_conflict=trainee_key,due_date,decision",
      {
        company_id: item.companyId,
        trainee_key: item.key,
        candidate_id: item.candidateId,
        profile_id: item.profileId,
        trainee_name: item.name,
        manager_profile_id: item.managerProfileId,
        due_date: item.dueDate,
        reason: item.reason,
        decision: "asked",
      },
      "return=representation,resolution=ignore-duplicates",
    );
    if (!res.ok) {
      summary.errors.push(`${item.name}: HTTP ${res.status} ${await res.text()}`);
      continue;
    }
    if (((await res.json()) as unknown[]).length === 0) continue; // asked already
    summary.newlyAsked.push(`${item.name} → ${item.managerName ?? "HR (no manager)"}`);
    if (item.managerProfileId) {
      if (!toManager.has(item.managerProfileId)) toManager.set(item.managerProfileId, { companyId: item.companyId, lines: [] });
      toManager.get(item.managerProfileId)!.lines.push(askLine(item, today));
    } else {
      if (!unassigned.has(item.companyId)) unassigned.set(item.companyId, []);
      unassigned.get(item.companyId)!.push(askLine(item, today));
    }
  }

  for (const [recipientId, { companyId, lines }] of toManager) {
    const body =
      lines.length === 1
        ? `🎓 Trainee decision needed: ${lines[0]}. Hire, keep training, or let go?`
        : `🎓 ${lines.length} trainees need your decision — hire, keep training, or let go: ${lines.join("; ")}.`;
    try {
      summary.notificationsSent += await notify(rest, [{ company_id: companyId, recipient_id: recipientId, sender_id: null, sender_name: "Training", body, link_to: PROMPT_LINK }]);
    } catch (e) {
      summary.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  for (const [companyId, lines] of unassigned) {
    try {
      const body = `🎓 No manager on file to ask about ${lines.length === 1 ? "this trainee" : `${lines.length} trainees`} (hire, keep training, or let go): ${lines.join("; ")}. Set their Manager on the Master List.`;
      const ids = await hrRecipientIds(rest, companyId);
      summary.notificationsSent += await notify(rest, ids.map((id) => ({ company_id: companyId, recipient_id: id, sender_id: null, sender_name: "Training", body, link_to: TRAINING_LIST_LINK })));
    } catch (e) {
      summary.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return summary;
}

// ───────────────────────────────────────────────────────────────────────
// /api/trainee-decision
// ───────────────────────────────────────────────────────────────────────

interface Caller {
  id: string;
  company_id: string;
  display_name: string | null;
  role: string | null;
  extra_roles: string[] | null;
  is_active: boolean;
}

export async function handleTraineeDecisionRequest(request: Request, env: Record<string, string | undefined>): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const rest = makeRest(env);
  if ("error" in rest) return json({ error: rest.error }, 500);
  const projectId = ((globalThis as any).__FIREBASE_PROJECT_ID__ || undefined) ?? env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) return json({ error: "Server missing VITE_FIREBASE_PROJECT_ID" }, 500);

  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
    if (!idToken) return json({ error: "Sign in to use this." }, 401);
    let uid: string;
    try {
      uid = (await verifyFirebaseToken(idToken, projectId)).sub;
    } catch {
      return json({ error: "Your session expired — sign in again." }, 401);
    }
    const caller = (
      await rest.get<Caller>(`profiles?select=id,company_id,display_name,role,extra_roles,is_active&firebase_uid=eq.${encodeURIComponent(uid)}&limit=1`)
    )[0];
    if (!caller?.is_active) return json({ error: "Your account isn't active." }, 403);
    const isHrAdmin = [caller.role, ...(caller.extra_roles ?? [])].some((r) => HR_ADMIN_ROLES.has(String(r ?? "").toUpperCase()));

    const today = nowInTimezone(DEFAULT_ATTENDANCE_TIMEZONE).dateISO;
    let queue: TraineeDecisionItem[];
    try {
      queue = await loadQueue(rest, today, caller.company_id);
    } catch (e) {
      if (isMissingTable(e)) return json({ items: [], setupNeeded: true });
      throw e;
    }

    if (payload.action === "queue") {
      return json({ items: queue.filter((i) => i.managerProfileId === caller.id), today });
    }
    if (payload.action !== "decide") return json({ error: "Unknown action" }, 400);

    const item = queue.find((i) => i.key === payload.key);
    if (!item) return json({ error: "This trainee isn't waiting on an answer any more — someone may have already answered." }, 409);
    if (item.managerProfileId !== caller.id && !isHrAdmin) return json({ error: "Only this trainee's manager or HR can answer." }, 403);

    const choice = payload.choice as TraineeDecisionChoice;
    const date = typeof payload.date === "string" ? payload.date : "";
    const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : "";
    if (!["hire", "extend", "let_go"].includes(choice)) return json({ error: "Pick Hire, Keep training, or Let go." }, 400);
    if (!ISO_DATE.test(date)) return json({ error: "Pick a date." }, 400);
    if (choice === "extend" && date <= today) return json({ error: "Keep training until tomorrow or later." }, 400);
    if (choice === "let_go" && !note) return json({ error: "Add the reason for letting them go." }, 400);

    const decisionDate = choice === "extend" ? addDaysISO(date, 1) : date;
    const callerName = caller.display_name || "A manager";

    // Record first: the unique (trainee, checkpoint, decision) row makes a
    // double-click a no-op instead of applying twice.
    const recordRes = await rest.send(
      "POST",
      "hr_trainee_decisions?on_conflict=trainee_key,due_date,decision",
      {
        company_id: item.companyId,
        trainee_key: item.key,
        candidate_id: item.candidateId,
        profile_id: item.profileId,
        trainee_name: item.name,
        manager_profile_id: item.managerProfileId,
        due_date: item.dueDate,
        reason: item.reason,
        decision: choice,
        decision_date: decisionDate,
        note: note || null,
        decided_by: caller.id,
        decided_by_name: callerName,
      },
      "return=representation,resolution=ignore-duplicates",
    );
    if (!recordRes.ok) throw new Error(`Saving the answer failed (${recordRes.status}): ${await recordRes.text()}`);
    const recorded = (await recordRes.json()) as { id: string }[];
    if (recorded.length === 0) return json({ error: "This trainee was already answered." }, 409);

    try {
      await applyDecision(rest, item, choice, date, decisionDate, note, caller, today);
    } catch (e) {
      // Not applied — drop the answer so it can be tried again.
      await rest.send("DELETE", `hr_trainee_decisions?id=eq.${recorded[0].id}`, undefined).catch(() => undefined);
      throw e;
    }

    // Tell HR (and, for a hire, the usual 🎉 hire recipients).
    const who = `${item.name}${item.position ? `, ${item.position}` : ""}${item.branch ? `, ${item.branch}` : ""}`;
    const hrBody =
      choice === "hire"
        ? `✅ ${callerName} hired trainee ${who} — Field Start ${fmt(date)}.`
        : choice === "extend"
          ? `⏳ ${callerName} is keeping ${who} in training until ${fmt(date)} — Field Start moved to ${fmt(decisionDate)}.`
          : `🚫 ${callerName} let go of trainee ${who} — last day ${fmt(date)}. Reason: ${note}. Marked Quit/Stopped${item.profileId ? " and their account was deactivated" : ""}.`;
    const notifyErrors: string[] = [];
    try {
      const hrIds = (await hrRecipientIds(rest, item.companyId)).filter((id) => id !== caller.id);
      await notify(rest, hrIds.map((id) => ({ company_id: item.companyId, recipient_id: id, sender_id: caller.id, sender_name: callerName, body: hrBody, link_to: TRAINING_LIST_LINK })));
      if (choice === "hire" && item.candidateId) {
        const managers = await rest.get<{ id: string }>(
          `profiles?select=id&company_id=eq.${item.companyId}&is_active=eq.true&role=in.(BRANCH_MANAGER,SENIOR_BRANCH_MANAGER)`,
        );
        const extras = await rest.get<{ id: string }>(`profiles?select=id&company_id=eq.${item.companyId}&id=in.(${HIRE_NOTIFICATION_EXTRA_RECIPIENT_IDS.join(",")})`);
        const ids = new Set([...managers, ...extras].map((r) => r.id));
        ids.delete(caller.id);
        const body = `🎉 ${item.name} was hired${item.position ? ` as ${item.position}` : ""}${item.branch ? ` (${item.branch})` : ""} — starting ${fmt(date)}.`;
        await notify(rest, [...ids].map((id) => ({ company_id: item.companyId, recipient_id: id, sender_id: caller.id, sender_name: callerName, body, link_to: `/m/hr/hr-dashboard?tab=hiring&viewCvCandidateId=${item.candidateId}` })));
      }
    } catch (e) {
      notifyErrors.push(e instanceof Error ? e.message : String(e));
      console.error("[trainee-decision] notify failed:", e);
    }
    return json({ ok: true, notifyErrors });
  } catch (err) {
    console.error("[trainee-decision] error:", err);
    return json({ error: err instanceof Error ? err.message : "Failed to save the answer" }, 500);
  }
}

async function applyDecision(
  rest: Rest,
  item: TraineeDecisionItem,
  choice: TraineeDecisionChoice,
  date: string,
  fieldStart: string,
  note: string,
  caller: Caller,
  today: string,
) {
  const check = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`${what} failed (${res.status}): ${await res.text()}`);
  };
  // Same RPC the Hiring tab uses (status history + Staff Needed counter);
  // it can't see who's calling under the service key, so stamp changed_by after.
  const setCandidateStatus = async (status: "hired" | "withdrawn", effective: string) => {
    const res = await fetch(`${rest.url}/rest/v1/rpc/hr_update_candidate_status`, {
      method: "POST",
      headers: rest.headers,
      body: JSON.stringify({
        p_candidate_id: item.candidateId,
        p_new_status: status,
        p_effective_date: effective,
        p_training_end_date: null,
        p_interview_time: null,
        p_interview_timezone: null,
      }),
    });
    await check(res, "Updating the Hiring status");
    await rest
      .send("PATCH", `hr_candidate_status_history?candidate_id=eq.${item.candidateId}&to_status=eq.${status}&effective_date=eq.${effective}&changed_by=is.null`, { changed_by: caller.id })
      .catch(() => undefined);
  };

  if (choice === "hire" || choice === "extend") {
    if (item.candidateId) await check(await rest.send("PATCH", `hr_candidates?id=eq.${item.candidateId}`, { training_end_date: fieldStart }), "Setting Field Start");
    if (item.profileId) {
      const patch: Record<string, unknown> = { training_end_date: fieldStart };
      if (choice === "hire" && fieldStart <= today) patch.employment_type = "regular";
      // Field Start already switched them to Regular — training isn't over after all.
      if (choice === "extend") patch.employment_type = "trainee";
      await check(await rest.send("PATCH", `profiles?id=eq.${item.profileId}`, patch), "Updating the account");
    }
    if (choice === "hire" && item.candidateId) await setCandidateStatus("hired", date);
    return;
  }

  // Let go — Training List's Quit/Stopped, done for the manager.
  if (item.candidateId) {
    await setCandidateStatus("withdrawn", date);
    const prior = (await rest.get<{ notes: string | null }>(`hr_candidates?select=notes&id=eq.${item.candidateId}`))[0]?.notes?.trim();
    await check(
      await rest.send("PATCH", `hr_candidates?id=eq.${item.candidateId}`, { notes: prior ? `${note} (earlier note: ${prior})` : note }),
      "Saving the reason",
    );
  }
  if (item.profileId) {
    const row = (await rest.get<{ employee_info: Record<string, unknown> | null; staff_note: string | null }>(`profiles?select=employee_info,staff_note&id=eq.${item.profileId}`))[0];
    const patch: Record<string, unknown> = {
      is_active: false,
      employee_info: { ...(row?.employee_info ?? {}), employmentStatus: "inactive", employmentStatusDate: date, terminateDate: date },
    };
    if (!item.candidateId) patch.staff_note = row?.staff_note?.trim() ? `${note} (earlier note: ${row.staff_note.trim()})` : note;
    await check(await rest.send("PATCH", `profiles?id=eq.${item.profileId}`, patch), "Deactivating the account");
  }
}
