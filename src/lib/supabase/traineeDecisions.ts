/**
 * Client side of the trainee decision ("Hire, keep training, or let go?" —
 * see src/lib/traineeDecision.ts). The queue and the answer go through
 * /api/trainee-decision, since the answer changes Hiring records and
 * accounts a Branch Manager can't edit; hr_trainee_decisions is read here
 * only to skip that call for everyone with nothing waiting.
 */
import { supabase } from "./client";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import type { TraineeDecisionChoice, TraineeDecisionItem } from "@/lib/traineeDecision";

// Migration 0407 not run yet: the table 404s. Remembered for a while in this
// tab so every page load doesn't log the same 404 in the console.
const MISSING_TABLE_KEY = "ahs.traineeDecisions.missingUntil";
const MISSING_TABLE_RECHECK_MS = 30 * 60 * 1000;
const tableKnownMissing = () => {
  try {
    return Number(sessionStorage.getItem(MISSING_TABLE_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
};

/** Whether the hourly job has asked this person about a trainee they haven't answered yet. */
export async function hasUnansweredTraineeAsk(profileId: string): Promise<boolean> {
  if (tableKnownMissing()) return false;
  const { data: asks, error } = await supabase
    .from("hr_trainee_decisions")
    .select("trainee_key, due_date")
    .eq("manager_profile_id", profileId)
    .eq("decision", "asked");
  if (error && (error.code === "PGRST205" || error.code === "42P01")) {
    try {
      sessionStorage.setItem(MISSING_TABLE_KEY, String(Date.now() + MISSING_TABLE_RECHECK_MS));
    } catch {
      /* storage blocked — just asks again next load */
    }
    return false;
  }
  if (error || !asks?.length) return false;
  const { data: answers } = await supabase
    .from("hr_trainee_decisions")
    .select("trainee_key, due_date")
    .in("trainee_key", Array.from(new Set(asks.map((a) => a.trainee_key))))
    .neq("decision", "asked");
  const answered = new Set((answers ?? []).map((a) => `${a.trainee_key}|${a.due_date}`));
  return asks.some((a) => !answered.has(`${a.trainee_key}|${a.due_date}`));
}

async function callTraineeDecisionApi<T>(body: Record<string, unknown>): Promise<T> {
  const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
  if (!idToken) throw new Error("Your session expired — sign in again.");
  const res = await fetch("/api/trainee-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Trainees waiting on the signed-in person's answer, and today's date (Central) on the server. */
export async function getMyTraineeDecisionQueue(): Promise<{ items: TraineeDecisionItem[]; today: string }> {
  const data = await callTraineeDecisionApi<{ items?: TraineeDecisionItem[]; today?: string }>({ action: "queue" });
  return { items: data.items ?? [], today: data.today ?? "" };
}

export async function submitTraineeDecision(input: { key: string; choice: TraineeDecisionChoice; date: string; note: string }): Promise<void> {
  await callTraineeDecisionApi({ action: "decide", ...input });
}
