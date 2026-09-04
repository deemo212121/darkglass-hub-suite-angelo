/**
 * Mobile's own Trainee Attendance review screen — appears ONLY right after
 * this viewer's own Check Out (see MobileTechApp.tsx's traineeReviewTrigger,
 * bumped by MobileHomeView's onSelfCheckedOut), not proactively on mount or
 * via realtime push. By a manager's own end-of-shift, a trainee they manage
 * has usually already logged both Time In AND Time Out for the day, so
 * reviewing here catches the whole day in one pass instead of interrupting
 * them mid-shift for just the clock-in.
 *
 * Exclusive to the trainee's own resolved direct manager (isDirectTraineeManager)
 * — deliberately narrower than canApproveTraineeDay, which also lets
 * Admin/HR/SuperAdmin/Finance/Senior Branch Manager act as a fallback when
 * the real manager is out. Those fallback reviewers can still approve/reject
 * from AttendanceMonitoringPage's "Trainee Attendance" tab, but must never
 * be forced into this unclosable popup for a trainee that isn't theirs. A
 * manager with no trainees under them (isDirectTraineeManager never
 * matches) simply sees nothing; their own checkout has already completed
 * by the time this fires either way, so declining to act here never blocks
 * or fails it. Unlike AnnouncementBanner-style popups, this has no
 * dismiss/X: it only goes away once every pending day has been Approved or
 * Rejected.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, GraduationCap } from "lucide-react";
import {
  getCompanyTraineeEntries,
  isDirectTraineeManager,
  approveTraineeDay,
  rejectTraineeDay,
  type TraineeTimecardEntry,
} from "@/lib/supabase/traineeTimecards";
import type { ProfileRow } from "@/lib/supabase/users";

interface PendingItem {
  entry: TraineeTimecardEntry;
  trainee: ProfileRow;
}

/** Fixed rejection categories the user asked for — "Other" reveals a required free-text field. */
const REJECT_REASON_OPTIONS = ["On Field", "Termination", "Absent", "Quit", "Other"] as const;

interface TraineeAttendanceMobileModalProps {
  myProfileId: string | null;
  users: ProfileRow[];
  /** Bumped by the parent every time this viewer's own Check Out just went through — the only thing that makes this component check for pending trainee days. 0 (the initial value) never triggers a check. */
  trigger: number;
}

function TimeField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-medium text-white">{value || "—"}</div>
    </div>
  );
}

export function TraineeAttendanceMobileModal({ myProfileId, users, trigger }: TraineeAttendanceMobileModalProps) {
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReasonOption, setRejectReasonOption] = useState("");
  const [rejectReasonCustom, setRejectReasonCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const finalRejectReason = rejectReasonOption === "Other" ? rejectReasonCustom.trim() : rejectReasonOption;
  const canSubmitReject = rejectReasonOption !== "" && (rejectReasonOption !== "Other" || rejectReasonCustom.trim() !== "");

  const load = async () => {
    if (!myProfileId || users.length === 0) return;
    try {
      const entries = await getCompanyTraineeEntries();
      const mine = entries.filter((e) => e.status === "pending" && isDirectTraineeManager(e, myProfileId));
      const withTrainee: PendingItem[] = mine
        .map((entry) => {
          const trainee = users.find((u) => u.id === entry.profileId);
          return trainee ? { entry, trainee } : null;
        })
        .filter((x): x is PendingItem => x !== null)
        .sort((a, b) => b.entry.workDate.localeCompare(a.entry.workDate));
      setPending(withTrainee);
    } catch (err) {
      console.error("Failed to load pending trainee attendance:", err);
    }
  };

  // trigger starts at 0 (never fired yet) — only an actual increment (this
  // viewer's own Check Out completing) checks for pending trainee days.
  const prevTrigger = useRef(trigger);
  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const selected = pending.find((p) => p.entry.id === selectedId) ?? null;

  const handleApprove = async (item: PendingItem) => {
    if (!myProfileId || submitting) return;
    setSubmitting(true);
    try {
      await approveTraineeDay(item.entry, myProfileId);
      setPending((prev) => prev.filter((p) => p.entry.id !== item.entry.id));
      setSelectedId(null);
    } catch (err) {
      console.error("Failed to approve trainee day:", err);
      alert("Couldn't approve this day — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitReject = async (item: PendingItem) => {
    if (!myProfileId || submitting || !canSubmitReject) return;
    setSubmitting(true);
    try {
      await rejectTraineeDay(item.entry.id, myProfileId, finalRejectReason);
      setPending((prev) => prev.filter((p) => p.entry.id !== item.entry.id));
      setSelectedId(null);
      setRejecting(false);
      setRejectReasonOption("");
      setRejectReasonCustom("");
    } catch (err) {
      console.error("Failed to reject trainee day:", err);
      alert("Couldn't submit the rejection — please try again.");
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
              onClick={() => { setSelectedId(null); setRejecting(false); setRejectReasonOption(""); setRejectReasonCustom(""); }}
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
            <div className="text-sm text-slate-400">{pending.length} day{pending.length === 1 ? "" : "s"} awaiting your review</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!selected ? (
            <ul className="space-y-2">
              {pending.map((item) => (
                <li key={item.entry.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.entry.id)}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{item.trainee.display_name || item.trainee.email}</div>
                      <div className="text-xs text-slate-400">{item.entry.workDate}</div>
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
                <div className="text-xs text-slate-400">{selected.entry.workDate}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TimeField label="Check In" value={selected.entry.checkIn} />
                <TimeField label="Check Out" value={selected.entry.checkOut} />
                <TimeField label="Meal In" value={selected.entry.mealStart} />
                <TimeField label="Meal Out" value={selected.entry.mealEnd} />
              </div>

              {!rejecting ? (
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleApprove(selected)}
                    className="flex-1 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setRejecting(true)}
                    className="flex-1 rounded-full border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300 transition disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  <label className="text-xs font-medium text-slate-300">Reason for rejection</label>
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
                      Submit Rejection
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
