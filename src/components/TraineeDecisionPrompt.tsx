/**
 * "Hire, keep training, or let go?" — pops up on its own for a trainee's
 * manager once the hourly job has asked them (after 2 weeks of training, and
 * on the last training day; see src/lib/traineeDecision.ts), on desktop and
 * on /mobile. Hire, Keep training (until a later date — asked again then) or
 * Let go (same as Training List's Quit/Stopped: withdrawn and account
 * deactivated). The answer is applied by /api/trainee-decision, and HR is
 * notified.
 *
 * "Remind me later" hides it for an hour in this browser; the notification
 * ("/home?traineeDecision=open", or TRAINEE_DECISION_OPEN_EVENT from the
 * mobile shell) brings it straight back.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, GraduationCap, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getMyTraineeDecisionQueue, hasUnansweredTraineeAsk, submitTraineeDecision } from "@/lib/supabase/traineeDecisions";
import { addDaysISO, TRAINEE_DECISION_OPEN_EVENT, type TraineeDecisionChoice, type TraineeDecisionItem } from "@/lib/traineeDecision";
import { formatISODate } from "@/lib/localDate";

const SNOOZE_KEY = "ahs.traineeDecision.snoozeUntil";
const SNOOZE_MS = 60 * 60 * 1000;
const RECHECK_MS = 30 * 60 * 1000;

const snoozed = () => {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
};
const setSnooze = (until: number | null) => {
  try {
    if (until) localStorage.setItem(SNOOZE_KEY, String(until));
    else localStorage.removeItem(SNOOZE_KEY);
  } catch {
    /* storage blocked — the popup just comes back sooner */
  }
};

const fmt = (iso: string | null) => (iso ? formatISODate(iso, { month: "short", day: "numeric", year: "numeric" }) : "—");

function whyLine(item: TraineeDecisionItem, today: string): string {
  if (item.reason === "two_weeks") return `2 weeks of training — since ${fmt(item.startDate)}`;
  const prefix = item.extended ? "Extended training " : "Training ";
  if (item.dueDate === today) return `${prefix}ends today · Field Start ${fmt(item.fieldStart)}`;
  return `${prefix}ended ${fmt(item.dueDate)}${item.fieldStart ? ` · Field Start ${fmt(item.fieldStart)}` : ""}`;
}

const CHOICES: { id: TraineeDecisionChoice; label: string; on: string }[] = [
  { id: "hire", label: "Hire", on: "border-emerald-400/60 bg-emerald-500/20 text-emerald-100" },
  { id: "extend", label: "Keep training", on: "border-sky-400/60 bg-sky-500/20 text-sky-100" },
  { id: "let_go", label: "Let go", on: "border-rose-400/60 bg-rose-500/20 text-rose-100" },
];

function defaultDate(choice: TraineeDecisionChoice, item: TraineeDecisionItem, today: string): string {
  if (choice === "hire") return item.fieldStart || today;
  if (choice === "extend") {
    const lastDay = item.fieldStart ? addDaysISO(item.fieldStart, -1) : null;
    return lastDay && lastDay > today ? lastDay : addDaysISO(today, 7);
  }
  return today;
}

function DecisionForm({ item, today, onDone }: { item: TraineeDecisionItem; today: string; onDone: () => void }) {
  const [choice, setChoice] = useState<TraineeDecisionChoice | null>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (c: TraineeDecisionChoice) => {
    setChoice(c);
    setDate(defaultDate(c, item, today));
    setError(null);
  };

  const submit = async () => {
    if (!choice || !date) return;
    if (choice === "let_go" && !note.trim()) {
      setError("Add the reason for letting them go.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await submitTraineeDecision({ key: item.key, choice, date, note });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your answer.");
    } finally {
      setSaving(false);
    }
  };

  const tomorrow = addDaysISO(today, 1);
  return (
    <div className="space-y-4">
      <div>
        <div className="text-base font-semibold text-white">{item.name}</div>
        <div className="text-xs text-slate-400">{[item.position, item.branch].filter(Boolean).join(" · ") || "Trainee"}</div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Fact label="Training since" value={fmt(item.startDate)} />
        <Fact label="Days" value={item.daysTraining == null ? "—" : String(item.daysTraining)} />
        <Fact label="Field Start" value={item.fieldStart ? fmt(item.fieldStart) : "Not set"} />
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-slate-300">Is {item.name.split(" ")[0]} ready?</div>
        <div className="grid grid-cols-3 gap-2">
          {CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c.id)}
              className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition ${choice === c.id ? c.on : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {choice && (
        <div className="space-y-3">
          <label className="block text-xs text-slate-300">
            {choice === "hire" ? "Field Start (first day on their own)" : choice === "extend" ? "Keep training until" : "Last day"}
            <input
              type="date"
              value={date}
              min={choice === "extend" ? tomorrow : undefined}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white [color-scheme:dark]"
            />
          </label>
          <label className="block text-xs text-slate-300">
            {choice === "let_go" ? "Reason (required)" : "Note (optional)"}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={choice === "let_go" ? "e.g. No call, no show; not ready for the field…" : ""}
              className="mt-1 w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
          </label>
          <p className="text-[11px] leading-snug text-slate-400">
            {choice === "hire" && "Hiring status becomes Hired, and they switch from Trainee to Regular on the Field Start date. HR is notified."}
            {choice === "extend" && date && `Field Start moves to ${fmt(addDaysISO(date, 1))}. You'll be asked again on ${fmt(date)}. HR is notified.`}
            {choice === "let_go" && "Same as Quit/Stopped on the Training List: Hiring status becomes Withdrawn and their account is deactivated right away. HR is notified."}
          </p>
          {error && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>}
          <button
            type="button"
            disabled={saving || !date || (choice === "extend" && date < tomorrow)}
            onClick={() => void submit()}
            className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50 ${
              choice === "let_go" ? "bg-rose-600 hover:bg-rose-700" : choice === "hire" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-sky-600 hover:bg-sky-700"
            }`}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {choice === "hire" ? `Hire ${item.name.split(" ")[0]}` : choice === "extend" ? "Keep training" : `Let ${item.name.split(" ")[0]} go`}
          </button>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-xs font-medium text-white">{value}</div>
    </div>
  );
}

export function TraineeDecisionPrompt() {
  const { ready, uid } = useAuth();
  const location = useLocation();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [items, setItems] = useState<TraineeDecisionItem[]>([]);
  const [today, setToday] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !uid) {
      setProfileId(null);
      return;
    }
    let cancelled = false;
    getMyProfileId(uid).then((pid) => { if (!cancelled) setProfileId(pid); });
    return () => { cancelled = true; };
  }, [ready, uid]);

  const load = useCallback(
    async (force: boolean) => {
      if (!profileId) return;
      try {
        if (!(await hasUnansweredTraineeAsk(profileId))) {
          setItems([]);
          return;
        }
        const queue = await getMyTraineeDecisionQueue();
        setItems(queue.items);
        setToday(queue.today);
        if (queue.items.length > 0 && (force || !snoozed())) setOpen(true);
      } catch (err) {
        console.error("Failed to load trainee decisions:", err);
      }
    },
    [profileId],
  );

  useEffect(() => {
    if (!profileId) return;
    void load(false);
    const timer = window.setInterval(() => void load(false), RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [profileId, load]);

  // The notification: desktop lands on ?traineeDecision=open, the mobile shell fires the event.
  const fromLink = /[?&]traineeDecision=/.test(location.href);
  useEffect(() => {
    if (!fromLink || !profileId) return;
    setSnooze(null);
    void load(true);
  }, [fromLink, profileId, load]);
  useEffect(() => {
    const handler = () => {
      setSnooze(null);
      void load(true);
    };
    window.addEventListener(TRAINEE_DECISION_OPEN_EVENT, handler);
    return () => window.removeEventListener(TRAINEE_DECISION_OPEN_EVENT, handler);
  }, [load]);

  if (!open || items.length === 0) return null;
  const selected = items.find((i) => i.key === selectedKey) ?? null;

  const answered = (key: string) => {
    const rest = items.filter((i) => i.key !== key);
    setItems(rest);
    setSelectedKey(null);
    if (rest.length === 0) setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-emerald-400/20 bg-slate-950 text-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          {selected && (
            <button
              type="button"
              onClick={() => setSelectedKey(null)}
              aria-label="Back to list"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200/80">Trainee decision</div>
            <div className="text-sm text-slate-400">
              {items.length} trainee{items.length === 1 ? "" : "s"} waiting on your answer
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {selected ? (
            <DecisionForm key={selected.key} item={selected} today={today} onDone={() => answered(selected.key)} />
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(item.key)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{item.name}</div>
                      <div className="truncate text-xs text-slate-400">{[item.position, item.branch].filter(Boolean).join(" · ")}</div>
                      <div className="text-xs text-emerald-200/80">{whyLine(item, today)}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!selected && (
          <div className="border-t border-white/10 px-5 py-3">
            <button
              type="button"
              onClick={() => {
                setSnooze(Date.now() + SNOOZE_MS);
                setOpen(false);
              }}
              className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/10"
            >
              Remind me later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
