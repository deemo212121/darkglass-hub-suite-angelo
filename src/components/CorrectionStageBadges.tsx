/**
 * Manager / HR / Accounting stage badges for a Time Correction, with the
 * overall result on top. Any 2 of the 3 stages decide the request, so once
 * it's Approved or Rejected a stage still sitting at "pending" is no longer
 * needed — shown greyed as "Not needed" instead of a yellow "Pending" that
 * made finished requests look unfinished.
 */
import type { CorrectionStatus } from "@/lib/supabase/timecardCorrections";

type StageRow = {
  status: CorrectionStatus;
  managerStatus: CorrectionStatus;
  hrStatus: CorrectionStatus;
  accountingStatus: CorrectionStatus;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CorrectionOverallBadge({ status, size = "sm" }: { status: CorrectionStatus; size?: "sm" | "md" }) {
  const pad = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  if (status === "approved") return <span className={`inline-flex items-center gap-1 rounded-full font-bold border whitespace-nowrap bg-green-600/30 text-green-200 border-green-500/60 ${pad}`}>✓ Approved</span>;
  if (status === "rejected") return <span className={`inline-flex items-center gap-1 rounded-full font-bold border whitespace-nowrap bg-red-600/30 text-red-200 border-red-500/60 ${pad}`}>✕ Rejected</span>;
  return <span className={`inline-flex items-center gap-1 rounded-full font-bold border whitespace-nowrap bg-yellow-500/20 text-yellow-200 border-yellow-500/50 ${pad}`}>● Pending</span>;
}

export function CorrectionStageBadges({ row }: { row: StageRow }) {
  const decided = row.status !== "pending";
  const stage = (label: string, s: CorrectionStatus) => {
    const notNeeded = decided && s === "pending";
    const cls = notNeeded
      ? "bg-slate-500/10 text-slate-500 border-slate-500/20"
      : s === "approved"
      ? "bg-green-500/20 text-green-300 border-green-500/30"
      : s === "rejected"
      ? "bg-red-500/20 text-red-300 border-red-500/30"
      : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${cls}`} title={notNeeded ? "Not needed — the request was already decided by the other two steps" : undefined}>
        {label}: {notNeeded ? "Not needed" : cap(s)}
      </span>
    );
  };
  return (
    <div className="flex flex-col gap-1">
      {stage("Manager", row.managerStatus)}
      {stage("HR", row.hrStatus)}
      {stage("Accounting", row.accountingStatus)}
    </div>
  );
}

/**
 * Comments column: the manager's comment from their approval signature,
 * plus each rejection reason (review_note holds one "Rejected by <name>
 * (<step>): <reason>" line per rejection). "—" when there are none.
 */
export function CorrectionComments({ row }: { row: { managerComments: string; managerSignatureName: string | null; reviewNote: string | null } }) {
  const managerComment = (row.managerComments ?? "").trim();
  const rejections = (row.reviewNote ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!managerComment && rejections.length === 0) return <span className="text-slate-600">—</span>;
  return (
    <div className="space-y-1.5 text-xs">
      {managerComment && (
        <p className="text-slate-300 whitespace-pre-line break-words">
          <span className="font-semibold text-green-300">Manager{row.managerSignatureName ? ` (${row.managerSignatureName})` : ""}:</span> {managerComment}
        </p>
      )}
      {rejections.map((line, i) => {
        const m = /^Rejected by (.+?) \(([^)]+)\): ([\s\S]*)$/.exec(line);
        return (
          <p key={i} className="text-red-100 whitespace-pre-line break-words">
            {m ? <><span className="font-semibold text-red-300">{m[2]} rejected ({m[1]}):</span> {m[3]}</> : line}
          </p>
        );
      })}
    </div>
  );
}
