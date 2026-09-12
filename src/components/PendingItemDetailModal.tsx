/**
 * Shared "what's actually behind this Pending badge" popup — either a
 * Timecard Correction (requested corrected clock times) or a PTO request
 * awaiting approval, each with its own manager/HR/Accounting stage status.
 * Originally built for the Absent List's Correction column, reused wherever
 * else a "Pending Time Correction Request" status shows up (e.g. Payroll's
 * per-employee Attendance table) so the same detail + inline approve/reject
 * is available without duplicating this component.
 *
 * Uses the same reviewCorrectionStage/reviewPtoStage +
 * canReviewCorrectionStage/canReviewPtoStage the Corrections tab, PTO
 * Management, and Time Off Calendar already use — approving here has
 * identical real effects (a correction upserts into the real timecard on
 * final approval, a PTO approval draws against balance, etc). Approves
 * exactly what was requested (no in-place editing of the corrected
 * times/dates) — the full edit-before-approving flow stays in Attendance
 * Monitoring's Corrections tab / PTO Management for anyone who needs it.
 */
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { ProfileRow } from "@/lib/supabase/users";
import { canReviewCorrectionStage, reviewCorrectionStage, type TimecardCorrectionRow, type CorrectionStage } from "@/lib/supabase/timecardCorrections";
import { canReviewPtoStage, reviewPtoStage, type PtoRequestRow, type PtoStage } from "@/lib/supabase/pto";

export type PendingItem = { type: "correction"; data: TimecardCorrectionRow } | { type: "pto"; data: PtoRequestRow };

const PTO_TYPE_LABELS: Record<PtoRequestRow["ptoType"], string> = {
  vacation: "Vacation",
  sick: "Sick Leave",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};

function stageBadge(status: "pending" | "approved" | "rejected"): { label: string; className: string } {
  if (status === "approved") return { label: "Approved", className: "bg-green-500/20 text-green-300" };
  if (status === "rejected") return { label: "Rejected", className: "bg-red-500/20 text-red-300" };
  return { label: "Pending", className: "bg-amber-500/20 text-amber-300" };
}

function fmtHHMM(t: string): string {
  return t || "—";
}

export function PendingItemDetailModal({
  profileName,
  date,
  item,
  profiles,
  myProfileId,
  myRole,
  myExtraRoles,
  myDisplayName,
  onClose,
  onReviewed,
}: {
  profileName: string;
  date: string;
  item: PendingItem;
  /** Company roster, for the manager-stage fallback (requester's current
   *  manager / that manager's own manager). Pass [] where the caller
   *  doesn't otherwise have the roster loaded — the fallback just won't
   *  apply (the primary managerId/role checks still work), no crash. */
  profiles: ProfileRow[];
  myProfileId: string | null;
  myRole: string | null | undefined;
  myExtraRoles: string[];
  myDisplayName: string | null | undefined;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const isCorrection = item.type === "correction";
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Manager-stage fallback chain (same as Attendance Monitoring/Time Off
  // Calendar): the requester's CURRENT manager, and that manager's own
  // manager, looked up fresh from the roster rather than trusting the
  // one-time managerId snapshot on the request itself.
  const requester = profiles.find((p) => p.id === item.data.profileId);
  const requesterManagerName = requester?.manager_name || null;
  const requesterManager = profiles.find((p) => (p.display_name || p.email) === requesterManagerName);
  const requesterManagersManagerName = requesterManager?.manager_name || null;

  const handleAction = async (stage: CorrectionStage | PtoStage, decision: "approved" | "rejected") => {
    if (!myProfileId) return;
    setBusyStage(`${stage}:${decision}`);
    setActionError(null);
    try {
      if (item.type === "correction") {
        await reviewCorrectionStage(
          item.data,
          stage as CorrectionStage,
          decision,
          myProfileId,
          myDisplayName || "Reviewer",
          decision === "approved"
            ? {
                checkIn: item.data.correctedCheckIn,
                checkOut: item.data.correctedCheckOut,
                mealStart: item.data.correctedMealStart,
                mealEnd: item.data.correctedMealEnd,
              }
            : undefined
        );
      } else {
        await reviewPtoStage(item.data, stage as PtoStage, decision, myProfileId, myDisplayName || "Reviewer");
      }
      onReviewed();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update.");
      setBusyStage(null);
    }
  };

  const stages: { label: string; stage: CorrectionStage | PtoStage; status: "pending" | "approved" | "rejected" }[] = [
    { label: "Manager", stage: "manager", status: item.data.managerStatus },
    { label: "HR", stage: "hr", status: item.data.hrStatus },
    { label: "Accounting", stage: "accounting", status: item.data.accountingStatus },
  ];
  const canReviewStage = (stage: CorrectionStage | PtoStage) =>
    isCorrection
      ? canReviewCorrectionStage(item.data, stage as CorrectionStage, myProfileId, myRole, myExtraRoles, myDisplayName, requesterManagersManagerName)
      : canReviewPtoStage(item.data, stage as PtoStage, myProfileId, myRole, myExtraRoles, myDisplayName, requesterManagerName, requesterManagersManagerName);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-base font-bold text-white">{isCorrection ? "Time Correction Request" : "PTO Request"}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{profileName} — {date}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition text-slate-400">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          {isCorrection ? (
            <>
              <div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] uppercase tracking-wide text-slate-500">
                  <span></span>
                  <span>Actual</span>
                  <span>Requested</span>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center mt-1">
                  <span className="text-xs text-slate-400">Clock In</span>
                  <span className="text-slate-300 font-mono text-sm">{fmtHHMM(item.data.originalCheckIn)}</span>
                  <span className="text-amber-200 font-mono text-sm font-semibold">{fmtHHMM(item.data.correctedCheckIn)}</span>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center mt-1">
                  <span className="text-xs text-slate-400">Clock Out</span>
                  <span className="text-slate-300 font-mono text-sm">{fmtHHMM(item.data.originalCheckOut)}</span>
                  <span className="text-amber-200 font-mono text-sm font-semibold">{fmtHHMM(item.data.correctedCheckOut)}</span>
                </div>
                {(item.data.correctedMealStart || item.data.correctedMealEnd || item.data.originalMealStart || item.data.originalMealEnd) && (
                  <>
                    <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center mt-2">
                      <span className="text-xs text-slate-400">Meal Start</span>
                      <span className="text-slate-300 font-mono text-sm">{fmtHHMM(item.data.originalMealStart)}</span>
                      <span className="text-amber-200 font-mono text-sm font-semibold">{fmtHHMM(item.data.correctedMealStart)}</span>
                    </div>
                    <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center mt-1">
                      <span className="text-xs text-slate-400">Meal End</span>
                      <span className="text-slate-300 font-mono text-sm">{fmtHHMM(item.data.originalMealEnd)}</span>
                      <span className="text-amber-200 font-mono text-sm font-semibold">{fmtHHMM(item.data.correctedMealEnd)}</span>
                    </div>
                  </>
                )}
              </div>
              {item.data.reason && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Reason</p>
                  <p className="text-slate-200">{item.data.reason}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Type</p>
                  <p className="text-slate-200">{PTO_TYPE_LABELS[item.data.ptoType] || item.data.ptoType}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Dates</p>
                  <p className="text-slate-200">{item.data.startDate === item.data.endDate ? item.data.startDate : `${item.data.startDate} – ${item.data.endDate}`}</p>
                </div>
              </div>
              {item.data.reason && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Reason</p>
                  <p className="text-slate-200">{item.data.reason}</p>
                </div>
              )}
            </>
          )}

          <div className="space-y-2 pt-1 border-t border-white/10">
            {stages.map(({ label, stage, status }) => {
              const badge = stageBadge(status);
              const actionable = status === "pending" && canReviewStage(stage);
              return (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400 w-20 shrink-0">{label}</span>
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${badge.className}`}>{badge.label}</span>
                  {actionable && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        type="button"
                        disabled={busyStage !== null}
                        onClick={() => handleAction(stage, "approved")}
                        className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition flex items-center gap-1"
                      >
                        {busyStage === `${stage}:approved` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyStage !== null}
                        onClick={() => handleAction(stage, "rejected")}
                        className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {actionError && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{actionError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
