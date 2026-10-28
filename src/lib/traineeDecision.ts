/**
 * "Hire, keep training, or let go?" — the trainee's manager is asked after
 * 2 weeks of training, and again on the last training day (the day before
 * Field Start), whichever comes first. One answer covers both: Hire or Let
 * go ends it; Keep training sets a new Field Start and asks again the day
 * before it. Asking on the last training day (not Field Start itself) lets
 * an extension land before traineeGraduation.ts switches them to Regular.
 *
 * Who's a trainee: Hiring records at status "training" (hr_candidates), plus
 * Master List trainees (employment_type "trainee") with no such record —
 * the same two sources Training List merges, matched by phone, then email.
 * A Master List trainee already asked stays on the list after the switch to
 * Regular until the manager answers.
 *
 * Who's asked: the trainee's manager on the Master List (manager_name — the
 * same person who approves their trainee attendance), else the Hiring
 * record's Branch Manager, Assigned Manager, then Trainer.
 *
 * Pure — used by the server (src/lib/server/traineeDecisions.ts) for the
 * hourly ask and for the popup's queue (TraineeDecisionPrompt.tsx).
 */

export const TRAINEE_DECISION_CHECK_DAYS = 14;
/** Fired to reopen the popup — a notification click on mobile, which can't navigate to ?traineeDecision. */
export const TRAINEE_DECISION_OPEN_EVENT = "ahs:trainee-decision-open";

export type TraineeDecisionReason = "two_weeks" | "training_end";
export type TraineeDecisionChoice = "hire" | "extend" | "let_go";

export interface DecisionCandidateRow {
  id: string;
  company_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  branch: string | null;
  status: string;
  training_start_date: string | null;
  training_end_date: string | null;
  branch_manager_id: string | null;
  assigned_manager_id: string | null;
  trainer_id: string | null;
}

export interface DecisionProfileRow {
  id: string;
  company_id: string;
  display_name: string | null;
  email: string | null;
  phone_number: string | null;
  role: string | null;
  is_active: boolean;
  employment_type: string | null;
  manager_name: string | null;
  assigned_branch: string | null;
  training_end_date: string | null;
  /** employee_info->>hireDate — Master List trainees' training start. */
  hire_date: string | null;
  /** employee_info->>terminateDate — set by Quit/Stopped. */
  terminate_date: string | null;
}

export interface TraineeDecisionRow {
  trainee_key: string;
  due_date: string;
  decision: "asked" | TraineeDecisionChoice;
  decision_date: string | null;
  created_at: string;
}

export interface TraineeDecisionItem {
  key: string;
  companyId: string;
  candidateId: string | null;
  profileId: string | null;
  name: string;
  position: string | null;
  branch: string | null;
  startDate: string | null;
  fieldStart: string | null;
  managerProfileId: string | null;
  managerName: string | null;
  dueDate: string;
  reason: TraineeDecisionReason;
  /** Days since training started, as of today. */
  daysTraining: number | null;
  /** The previous answer was Keep training. */
  extended: boolean;
}

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const normPhone = (v: string | null | undefined) => {
  const digits = (v ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

/**
 * The checkpoint waiting on the manager today, or null. Hire / Let go end
 * it. Keep training moves Field Start, so the next ask is the day before the
 * (current) Field Start. Otherwise the earlier of 2 weeks in and the last
 * training day.
 */
export function traineeCheckpoint(
  startDate: string | null,
  fieldStart: string | null,
  answers: TraineeDecisionRow[],
  today: string,
): { dueDate: string; reason: TraineeDecisionReason; extended: boolean } | null {
  const last = answers.filter((a) => a.decision !== "asked").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (last && last.decision !== "extend") return null;
  const points: { dueDate: string; reason: TraineeDecisionReason }[] = [];
  if (last) {
    const end = fieldStart || last.decision_date;
    if (end) points.push({ dueDate: addDaysISO(end, -1), reason: "training_end" });
  } else {
    if (startDate) points.push({ dueDate: addDaysISO(startDate, TRAINEE_DECISION_CHECK_DAYS), reason: "two_weeks" });
    if (fieldStart) points.push({ dueDate: addDaysISO(fieldStart, -1), reason: "training_end" });
  }
  points.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const next = points[0];
  if (!next || next.dueDate > today) return null;
  // Keep training's next ask never lands on the day it was answered.
  if (last && next.dueDate <= last.due_date) return null;
  return { ...next, extended: !!last };
}

/** Every trainee whose manager owes an answer today, for one company or all. */
export function buildTraineeDecisionQueue(
  candidates: DecisionCandidateRow[],
  profiles: DecisionProfileRow[],
  decisions: TraineeDecisionRow[],
  today: string,
): TraineeDecisionItem[] {
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const activeByName = new Map<string, DecisionProfileRow>();
  for (const p of profiles) if (p.is_active && p.display_name) activeByName.set(`${p.company_id}|${norm(p.display_name)}`, p);
  const byPhone = new Map<string, DecisionProfileRow>();
  const byEmail = new Map<string, DecisionProfileRow>();
  for (const p of profiles) {
    const ph = normPhone(p.phone_number);
    const em = norm(p.email);
    if (ph && !byPhone.has(`${p.company_id}|${ph}`)) byPhone.set(`${p.company_id}|${ph}`, p);
    if (em && !byEmail.has(`${p.company_id}|${em}`)) byEmail.set(`${p.company_id}|${em}`, p);
  }
  const linkedProfile = (c: DecisionCandidateRow) => {
    const ph = normPhone(c.phone);
    const em = norm(c.email);
    return (ph ? byPhone.get(`${c.company_id}|${ph}`) : undefined) ?? (em ? byEmail.get(`${c.company_id}|${em}`) : undefined);
  };
  const answersByKey = new Map<string, TraineeDecisionRow[]>();
  for (const d of decisions) {
    if (!answersByKey.has(d.trainee_key)) answersByKey.set(d.trainee_key, []);
    answersByKey.get(d.trainee_key)!.push(d);
  }

  const managerFor = (companyId: string, profile: DecisionProfileRow | undefined, candidate: DecisionCandidateRow | undefined) => {
    const named = profile?.manager_name ? activeByName.get(`${companyId}|${norm(profile.manager_name)}`) : undefined;
    if (named && named.id !== profile?.id) return named;
    for (const id of [candidate?.branch_manager_id, candidate?.assigned_manager_id, candidate?.trainer_id]) {
      const p = id ? profileById.get(id) : undefined;
      if (p?.is_active && p.company_id === companyId) return p;
    }
    return undefined;
  };

  const items: TraineeDecisionItem[] = [];
  const push = (base: Omit<TraineeDecisionItem, "dueDate" | "reason" | "daysTraining" | "extended">) => {
    const cp = traineeCheckpoint(base.startDate, base.fieldStart, answersByKey.get(base.key) ?? [], today);
    if (!cp) return;
    items.push({ ...base, ...cp, daysTraining: base.startDate ? Math.max(0, daysBetween(base.startDate, today)) : null });
  };

  // Newest training record first, so a person with two only gets asked about the latest.
  const training = candidates
    .filter((c) => c.status === "training")
    .sort((a, b) => (b.training_start_date ?? "").localeCompare(a.training_start_date ?? ""));
  const linkedProfileIds = new Set<string>();
  for (const c of training) {
    const profile = linkedProfile(c);
    if (profile && linkedProfileIds.has(profile.id)) continue;
    if (profile) linkedProfileIds.add(profile.id);
    if (profile && (!profile.is_active || profile.terminate_date)) continue; // already gone
    const manager = managerFor(c.company_id, profile, c);
    push({
      key: `candidate:${c.id}`,
      companyId: c.company_id,
      candidateId: c.id,
      profileId: profile?.id ?? null,
      name: c.full_name || profile?.display_name || "Trainee",
      position: c.position,
      branch: c.branch || profile?.assigned_branch || null,
      startDate: c.training_start_date,
      fieldStart: c.training_end_date || profile?.training_end_date || null,
      managerProfileId: manager?.id ?? null,
      managerName: manager?.display_name ?? null,
    });
  }

  for (const p of profiles) {
    if (!p.is_active || p.terminate_date || linkedProfileIds.has(p.id)) continue;
    const key = `profile:${p.id}`;
    const asked = (answersByKey.get(key) ?? []).length > 0;
    if (p.employment_type !== "trainee" && !asked) continue;
    const manager = managerFor(p.company_id, p, undefined);
    push({
      key,
      companyId: p.company_id,
      candidateId: null,
      profileId: p.id,
      name: p.display_name || p.email || "Trainee",
      position: null,
      branch: p.assigned_branch,
      startDate: p.hire_date || null,
      fieldStart: p.training_end_date,
      managerProfileId: manager?.id ?? null,
      managerName: manager?.display_name ?? null,
    });
  }
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}
