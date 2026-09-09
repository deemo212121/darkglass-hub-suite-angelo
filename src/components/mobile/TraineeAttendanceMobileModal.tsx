/**
 * Mobile's own Trainee Attendance review screen — appears the moment this
 * viewer ATTEMPTS their own Check Out (see MobileTechApp.tsx's
 * traineeReviewTrigger, bumped by MobileHomeView's persistPunch both
 * pre-emptively, when a pending trainee day is holding the checkout, and
 * again once the checkout actually saves), not proactively on mount or via
 * realtime push. By a manager's own end-of-shift, a trainee they manage
 * has usually already logged both Time In AND Time Out for the day, so
 * reviewing here catches the whole day in one pass instead of interrupting
 * them mid-shift for just the clock-in.
 *
 * Per the user's explicit call, the manager's Check Out is HELD — not
 * recorded — until every pending trainee day is resolved; persistPunch
 * checks getPendingTraineeReviewCount before saving and blocks it if any
 * remain, so tapping Time Out again afterward is what actually completes
 * the checkout. The queue itself (getTraineeReviewQueue) covers not just
 * an existing pending punch but ALSO any trainee under this manager who
 * hasn't punched at all yet today — per the user's explicit call, a no-
 * show is exactly as much something to review (mark Absent, etc.) as a
 * late one, so it must show up here too, not just once they've punched.
 *
 * Exclusive to the trainee's own resolved direct manager (isDirectTraineeManager
 * for an existing entry, or a plain manager_name match for a no-show —
 * see getTraineeReviewQueue) — deliberately narrower than canApproveTraineeDay,
 * which also lets Admin/HR/SuperAdmin/Finance/Senior Branch Manager act as
 * a fallback when the real manager is out. Those fallback reviewers can
 * still approve/reject from AttendanceMonitoringPage's "Trainee Attendance"
 * tab, but are never gated by this — only the trainee's actual manager has
 * their own checkout held. A manager with no trainees under them simply
 * sees nothing and their checkout is never held. Unlike AnnouncementBanner-
 * style popups, this has no dismiss/X: it only goes away once every
 * pending item has been Approved/Rejected/marked.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, GraduationCap } from "lucide-react";
import {
  getTraineeReviewQueue,
  approveTraineeDay,
  rejectTraineeDay,
  recordTraineeDayWithoutPunch,
  type TraineeReviewQueueItem,
} from "@/lib/supabase/traineeTimecards";
/** Fixed rejection categories the user asked for — "Other" reveals a required free-text field. */
const REJECT_REASON_OPTIONS = ["On Field", "Termination", "Absent", "Quit", "Other"] as const;

/** entry items key by the real row's id; a "noshow" item has no row yet, so its trainee's profile id stands in. */
const itemKey = (item: TraineeReviewQueueItem) => (item.kind === "entry" ? item.entry!.id : `noshow:${item.trainee.id}`);

function TimeField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-medium text-white">{value || "—"}</div>
    </div>
  );
}

interface TraineeAttendanceMobileModalProps {
  myProfileId: string | null;
  /** Bumped by the parent every time this viewer's own Check Out is attempted or actually goes through — the only thing that makes this component check for pending trainee days. 0 (the initial value) never triggers a check. */
  trigger: number;
}

export function TraineeAttendanceMobileModal({ myProfileId, trigger }: TraineeAttendanceMobileModalProps) {
  const [pending, setPending] = useState<TraineeReviewQueueItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReasonOption, setRejectReasonOption] = useState("");
  const [rejectReasonCustom, setRejectReasonCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const finalRejectReason = rejectReasonOption === "Other" ? rejectReasonCustom.trim() : rejectReasonOption;
  const canSubmitReject = rejectReasonOption !== "" && (rejectReasonOption !== "Other" || rejectReasonCustom.trim() !== "");

  const load = async () => {
    if (!myProfileId) return;
    try {
      const queue = await getTraineeReviewQueue(myProfileId);
      queue.sort((a, b) => b.workDate.localeCompare(a.workDate) || a.trainee.display_name?.localeCompare(b.trainee.display_name || "") || 0);
      setPending(queue);
    } catch (err) {
      console.error("Failed to load pending trainee attendance:", err);
    }
  };

  // trigger starts at 0 (never fired yet) — only an actual increment (this
  // viewer attempting or completing their own Check Out) checks for
  // pending trainee days.
  const prevTrigger = useRef(trigger);
  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const selected = pending.find((p) => itemKey(p) === selectedKey) ?? null;

  const handleApprove = async (item: TraineeReviewQueueItem) => {
    if (!myProfileId || submitting || item.kind !== "entry" || !item.entry) return;
    setSubmitting(true);
    try {
      await approveTraineeDay(item.entry, myProfileId);
      setPending((prev) => prev.filter((p) => itemKey(p) !== itemKey(item)));
      setSelectedKey(null);
    } catch (err) {
      console.error("Failed to approve trainee day:", err);
      alert("Couldn't approve this day — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitReject = async (item: TraineeReviewQueueItem) => {
    if (!myProfileId || submitting || !canSubmitReject) return;
    setSubmitting(true);
    try {
      if (item.kind === "entry" && item.entry) {
        await rejectTraineeDay(item.entry.id, myProfileId, finalRejectReason);
      } else {
        // No-show — nothing punched yet, so there's no row to update; this
        // creates it directly already in "rejected" (see
        // recordTraineeDayWithoutPunch's own doc comment).
        await recordTraineeDayWithoutPunch(item.trainee.id, item.workDate, myProfileId, myProfileId, finalRejectReason);
      }
      setPending((prev) => prev.filter((p) => itemKey(p) !== itemKey(item)));
      setSelectedKey(null);
      setRejecting(false);
      setRejectReasonOption("");
      setRejectReasonCustom("");
    } catch (err) {
      console.error("Failed to submit trainee status:", err);
      alert("Couldn't submit this — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!myProfileId || pending.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl border border-sky-400/20 bg-slate-950 text-white shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          {selected && (
            <button
              type="button"
              onClick={() => { setSelectedKey(null); setRejecting(false); setRejectReasonOption(""); setRejectReasonCustom(""); }}
              aria-label="Back to list"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sky-200">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/80">Trainee Attendance</div>
            <div className="text-sm text-slate-400">{pending.length} item{pending.length === 1 ? "" : "s"} awaiting your review</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!selected ? (
            <ul className="space-y-2">
              {pending.map((item) => (
                <li key={itemKey(item)}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(itemKey(item))}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{item.trainee.display_name || item.trainee.email}</div>
                      <div className="text-xs text-slate-400">
                        {item.kind === "noshow" ? `Not clocked in — ${item.workDate}` : item.workDate}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-base font-semibold text-white">{selected.trainee.display_name || selected.trainee.email}</div>
                <div className="text-xs text-slate-400">
                  {selected.kind === "noshow" ? `Not clocked in — ${selected.workDate}` : selected.workDate}
                </div>
              </div>

              {selected.kind === "entry" && selected.entry && (
                <div className="grid grid-cols-2 gap-3">
                  <TimeField label="Check In" value={selected.entry.checkIn} />
                  <TimeField label="Check Out" value={selected.entry.checkOut} />
                  <TimeField label="Meal In" value={selected.entry.mealStart} />
                  <TimeField label="Meal Out" value={selected.entry.mealEnd} />
                </div>
              )}

              {!rejecting ? (
                <div className="flex gap-3 pt-2">
                  {selected.kind === "entry" && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleApprove(selected)}
                      className="flex-1 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setRejecting(true)}
                    className="flex-1 rounded-full border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300 transition disabled:opacity-50"
                  >
                    {selected.kind === "noshow" ? "Mark Status" : "Reject"}
                  </button>
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  <label className="text-xs font-medium text-slate-300">{selected.kind === "noshow" ? "Reason" : "Reason for rejection"}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {REJECT_REASON_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setRejectReasonOption(opt)}
                        className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                          rejectReasonOption === opt
                            ? "border-red-400/60 bg-red-500/20 text-red-200"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  {rejectReasonOption === "Other" && (
                    <textarea
                      value={rejectReasonCustom}
                      onChange={(e) => setRejectReasonCustom(e.target.value)}
                      rows={3}
                      placeholder="Specify the reason…"
                      autoFocus
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-red-400/50 focus:outline-none"
                    />
                  )}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setRejecting(false); setRejectReasonOption(""); setRejectReasonCustom(""); }}
                      className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-300 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={submitting || !canSubmitReject}
                      onClick={() => submitReject(selected)}
                      className="flex-1 rounded-full bg-red-500 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
                    >
                      {selected.kind === "noshow" ? "Submit" : "Submit Rejection"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
