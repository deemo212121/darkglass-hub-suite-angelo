/**
 * Attendance Monitoring → Reverts: every decision that's been reverted, for the
 * Super Admin. The Revert buttons themselves stay on each record; this is the
 * record of what happened. New kinds of record show up here as they're added.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useColumnFunnels } from "@/hooks/useColumnFunnels";
import { getDecisionReverts, type DecisionRevert } from "@/lib/supabase/decisionReverts";
import { REVERT_RECORD_LABEL, REVERT_STAGE_LABEL } from "@/lib/decisionRevertRules";

const whenText = (iso: string) => new Date(iso).toLocaleString();
const stepText = (r: DecisionRevert) => (r.stage ? REVERT_STAGE_LABEL[r.stage] : "—");
const wasText = (r: DecisionRevert) => (r.previousStatus === "approved" ? "Approved" : r.previousStatus === "rejected" ? "Rejected" : r.previousStatus);

export function RevertsLogTab() {
  const [rows, setRows] = useState<DecisionRevert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDecisionReverts()
      .then(setRows)
      .catch((err) => {
        setRows([]);
        setError(err instanceof Error ? err.message : "Couldn't load the reverts.");
      });
  }, []);

  const funnels = useColumnFunnels(
    rows ?? [],
    {
      Type: (r) => REVERT_RECORD_LABEL[r.recordType] ?? r.recordType,
      Employee: (r) => r.subjectName || "—",
      Step: stepText,
      Was: wasText,
      "Decided By": (r) => r.previousDecidedByName || "—",
      "Reverted By": (r) => r.revertedByName || "—",
    },
    (r) => r.id
  );

  const th = (label: string, funnel = true) => (
    <th key={label} className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase text-slate-400">
      <span className="inline-flex items-center gap-1">
        {label}
        {funnel && funnels.funnel(label)}
      </span>
    </th>
  );

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">Reverts</h2>
        {funnels.activeCount > 0 && (
          <button type="button" onClick={funnels.clear} className="rounded-md border border-blue-400/30 bg-blue-500/10 px-2 py-1 text-[11px] font-semibold text-blue-200 hover:bg-blue-500/20">
            Clear column filters ({funnels.activeCount})
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-slate-400">Every decision that's been sent back to Pending, newest first. Use the Revert button on the request itself to revert one.</p>
      {error && <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
      {rows === null ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                {th("When", false)}
                {th("Type")}
                {th("Employee")}
                {th("About", false)}
                {th("Step")}
                {th("Was")}
                {th("Decided By")}
                {th("Reverted By")}
                {th("Note", false)}
              </tr>
            </thead>
            <tbody>
              {funnels.visible.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">{rows.length === 0 ? "Nothing has been reverted yet." : "Nothing matches the column filters."}</td></tr>
              ) : (
                funnels.visible.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 align-top hover:bg-white/5">
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-400">{whenText(r.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-300">{REVERT_RECORD_LABEL[r.recordType] ?? r.recordType}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-white">{r.subjectName || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-300">
                      {r.label || "—"}
                      {r.recordType === "ticket_time_dispute" && r.details?.times_restored === false && r.previousStatus === "approved" && (
                        <span className="mt-0.5 block text-amber-300">Ticket times not restored</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-300">{stepText(r)}</td>
                    <td className={`whitespace-nowrap px-3 py-2.5 font-semibold ${r.previousStatus === "approved" ? "text-green-300" : "text-red-300"}`}>{wasText(r)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-300">{r.previousDecidedByName || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-300">{r.revertedByName || "—"}</td>
                    <td className="min-w-[14rem] px-3 py-2.5 text-slate-200 whitespace-pre-line break-words">{r.note}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
