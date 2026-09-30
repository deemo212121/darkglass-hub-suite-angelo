/**
 * Desktop's own Trainee Attendance review — appears the moment this viewer
 * ATTEMPTS their own Check Out (see SELF_CHECKED_OUT_EVENT, dispatched by
 * TimeClockMenu.tsx and routes/timecard.tsx BOTH pre-emptively, when a
 * pending trainee day is holding the checkout, and again once it actually
 * saves), mirroring mobile's TraineeAttendanceMobileModal move-for-move.
 * By the reviewer's own end of shift, a trainee they manage usually already
 * has both Time In AND Time Out recorded, so this catches the whole day in
 * one pass.
 *
 * Per the user's explicit call, the manager's Check Out is HELD — not
 * recorded — until every pending trainee day is resolved; the two dispatch
 * sites check getPendingTraineeReviewCount before saving and refuse to
 * proceed if any remain, so clicking Time Out again afterward is what
 * actually completes the checkout. The queue itself (getTraineeReviewQueue)
 * covers not just an existing pending punch but ALSO any trainee under
 * this manager who hasn't punched at all yet today — per the user's
 * explicit call, a no-show is exactly as much something to review (mark
 * Absent, etc.) as a late one, so it must show up here too.
 *
 * Exclusive to the trainee's own resolved direct manager (isDirectTraineeManager
 * for an existing entry, or a plain manager_name match for a no-show —
 * see getTraineeReviewQueue) — deliberately narrower than canApproveTraineeDay,
 * which also lets Admin/HR/SuperAdmin/Finance/Senior Branch Manager act as
 * a fallback when the real manager is out. Those fallback reviewers can
 * still approve/reject from AttendanceMonitoringPage's "Trainee Attendance"
 * tab, but are never gated by this — only the trainee's actual manager has
 * their own checkout held. A viewer with no trainees under them sees
 * nothing and their checkout is never held.
 *
 * The pop-up doesn't approve/reject itself any more — "Review Timecard"
 * opens that day in the Trainee Attendance tab (editor already open, via
 * ?review=/?trainee= + ?date=), where the trainer can correct the times
 * before approving. No dismiss/X: the only way out is to go review.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, GraduationCap } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import {
  getTraineeReviewQueue,
  SELF_CHECKED_OUT_EVENT,
  type TraineeReviewQueueItem,
} from "@/lib/supabase/traineeTimecards";

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

export function TraineeAttendanceReviewModal() {
  const { ready, uid } = useAuth();
  const navigate = useNavigate();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [pending, setPending] = useState<TraineeReviewQueueItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    getMyProfileId(uid).then((pid) => { if (!cancelled) setProfileId(pid); });
    return () => { cancelled = true; };
  }, [ready, uid]);

  useEffect(() => {
    if (!profileId) return;
    const handler = () => {
      (async () => {
        try {
          const queue = await getTraineeReviewQueue(profileId);
          queue.sort((a, b) => b.workDate.localeCompare(a.workDate) || (a.trainee.display_name || "").localeCompare(b.trainee.display_name || ""));
          setPending(queue);
        } catch (err) {
          console.error("Failed to load pending trainee attendance:", err);
        }
      })();
    };
    window.addEventListener(SELF_CHECKED_OUT_EVENT, handler);
    return () => window.removeEventListener(SELF_CHECKED_OUT_EVENT, handler);
  }, [profileId]);

  const selected = pending.find((p) => itemKey(p) === selectedKey) ?? null;

  // Review happens in the Trainee Attendance tab, where the times can be
  // corrected before approving (a trainee often forgets to clock out, or
  // the trainer leaves first). This pop-up only points there; the trainer's
  // checkout stays held until the day is resolved, so it reappears on their
  // next Time Out attempt if they leave the tab without acting.
  const openInTab = (item: TraineeReviewQueueItem) => {
    setPending([]);
    setSelectedKey(null);
    navigate({
      to: "/m/$module/$submodule",
      params: { module: "dashboard", submodule: "attendance-monitoring" },
      search: (item.kind === "entry" && item.entry
        ? { tab: "trainee-attendance", review: item.entry.id, date: item.workDate }
        : { tab: "trainee-attendance", trainee: item.trainee.id, date: item.workDate }) as any,
    });
  };

  if (!profileId || pending.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-sky-400/20 bg-slate-950 text-white shadow-2xl">
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

              <button
                type="button"
                onClick={() => openInTab(selected)}
                className="w-full rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                {selected.kind === "noshow" ? "Review in Trainee Attendance" : "Review Timecard"}
              </button>
              <p className="text-center text-[11px] text-slate-500">
                Opens this day in Attendance Monitoring → Trainee Attendance, where you can correct the times and approve.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
