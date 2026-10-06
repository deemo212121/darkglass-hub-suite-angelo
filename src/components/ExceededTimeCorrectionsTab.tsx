/**
 * Employee Monitoring -> Exceeded -> Time Corrections.
 *
 * Three lists: Technician (Technician / Branch Manager / Senior Branch
 * Manager / Technical Director / Technical Assistant Director), US (Parts
 * staff only) and PH (everyone at the Philippines branch) — with how many
 * timecard corrections
 * each filed for the selected month (by the day being corrected). The
 * allowance is MAX_CORRECTIONS_PER_MONTH; anyone over it gets an "Over limit"
 * flag. Clicking a name opens that person's timecards for the month, with
 * the corrected days marked. Admin / HR / Super Admin can mark a correction
 * Exempt (with a reason) so it doesn't count — see correctionExemptions.ts.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Flag, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AppModal } from "@/components/ui-kit/AppModal";
import {
  getCorrectionExemptions,
  exemptCorrection,
  removeCorrectionExemption,
  type CorrectionExemption,
} from "@/lib/supabase/correctionExemptions";
import { ROLE_LABELS, TECHNICIAN_PAY_ROLES, BM_AND_UP_ROLES, normalizeRole } from "@/lib/roleLabels";
import type { ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import {
  getCompanyTimecardCorrections,
  correctionShiftMinutes,
  formatShift,
  type TimecardCorrectionRow,
} from "@/lib/supabase/timecardCorrections";
import { EXCEPTION_TYPE_LABELS, CORRECTION_ISSUE_LABELS } from "@/lib/exceptionVisitReportTemplate";
import { EmptyState } from "@/components/ui-kit/EmptyState";
import { TableSkeleton } from "@/components/ui-kit/TableSkeleton";

/** Corrections allowed per person per month; more than this is flagged. */
export const MAX_CORRECTIONS_PER_MONTH = 2;

const PH_BRANCH = "Philippines";

type Region = "TECH" | "US" | "PH";
type GroupKey =
  | "TECHNICIAN"
  | "BRANCH_MANAGER"
  | "SENIOR_BRANCH_MANAGER"
  | "TECHNICAL_DIRECTOR"
  | "TECHNICAL_ASSISTANT_DIRECTOR"
  | "PARTS"
  | "PARTS_TEAM_LEADER"
  | "PARTS_MANAGER"
  | "PARTS_ORDER"
  | "PH";

const REGIONS: { key: Region; label: string }[] = [
  { key: "TECH", label: "Technician" },
  { key: "US", label: "US (Parts)" },
  { key: "PH", label: "PH" },
];

const GROUPS: { key: GroupKey; label: string; region: Region }[] = [
  { key: "TECHNICIAN", label: "Technician", region: "TECH" },
  { key: "BRANCH_MANAGER", label: "Branch Manager", region: "TECH" },
  { key: "SENIOR_BRANCH_MANAGER", label: "Senior Branch Manager", region: "TECH" },
  { key: "TECHNICAL_DIRECTOR", label: "Technical Director", region: "TECH" },
  { key: "TECHNICAL_ASSISTANT_DIRECTOR", label: "Technical Assistant Director", region: "TECH" },
  { key: "PARTS", label: "Parts", region: "US" },
  { key: "PARTS_TEAM_LEADER", label: "Parts Team Leader", region: "US" },
  { key: "PARTS_MANAGER", label: "Parts Manager", region: "US" },
  { key: "PARTS_ORDER", label: "Parts Order", region: "US" },
  { key: "PH", label: "Philippines", region: "PH" },
];

const PARTS_ROLES = new Set(["PARTS", "PARTS_TEAM_LEADER", "PARTS_MANAGER", "PARTS_ORDER"]);

function groupOf(p: ProfileRow): GroupKey | null {
  if (p.assigned_branch === PH_BRANCH) return "PH";
  const role = normalizeRole(p.role);
  if (BM_AND_UP_ROLES.has(role)) return role as GroupKey;
  if (TECHNICIAN_PAY_ROLES.has(role)) return "TECHNICIAN";
  if (PARTS_ROLES.has(role)) return role as GroupKey;
  return null;
}

const regionOf = (g: GroupKey): Region => GROUPS.find((x) => x.key === g)!.region;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function to12h(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return "—";
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "Forgot to clock", "System Issue", … — the issue picked on the request. */
function issueLabel(c: TimecardCorrectionRow): string | null {
  if (!c.exceptionType) return null;
  const labels: Record<string, string> = { ...EXCEPTION_TYPE_LABELS, ...CORRECTION_ISSUE_LABELS };
  const label = labels[c.exceptionType] ?? c.exceptionType;
  return c.exceptionType === "other" && c.otherDescription ? `Other: ${c.otherDescription}` : label;
}

/** What the request changed, e.g. "In 9:04 AM · Out 5:45 PM" — only the times it actually set. */
function correctedTimes(c: TimecardCorrectionRow): string {
  const parts: string[] = [];
  if (c.correctedCheckIn) parts.push(`In ${to12h(c.correctedCheckIn)}`);
  if (c.correctedMealStart) parts.push(`Meal ${to12h(c.correctedMealStart)}–${to12h(c.correctedMealEnd)}`);
  if (c.correctedCheckOut) parts.push(`Out ${to12h(c.correctedCheckOut)}`);
  return parts.join(" · ");
}

/** Approved and pending corrections count toward the monthly limit; rejected ones changed nothing, and exempt ones were excused. */
function countsTowardLimit(c: TimecardCorrectionRow, activeExemption: Map<string, unknown>): boolean {
  return c.status !== "rejected" && !activeExemption.has(c.id);
}

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-green-500/15 text-green-300 border-green-500/30",
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
};

interface PersonRow {
  profile: ProfileRow;
  group: GroupKey;
  corrections: TimecardCorrectionRow[];
  /** Corrections that count toward the limit (not exempt). */
  counted: number;
  exemptCount: number;
}

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

type ExemptDialog =
  | { kind: "exempt"; correction: TimecardCorrectionRow; personName: string }
  | { kind: "remove"; correction: TimecardCorrectionRow; personName: string; exemption: CorrectionExemption };

export function ExceededTimeCorrectionsTab({
  profiles,
  canExempt,
  myName,
  myProfileId,
}: {
  profiles: ProfileRow[];
  /** Admin / HR / Super Admin — matches migration 0355's write policy. */
  canExempt: boolean;
  myName: string;
  myProfileId: string | null;
}) {
  const [month, setMonth] = useState(currentMonth());
  const [region, setRegion] = useState<Region>("TECH");
  const [search, setSearch] = useState("");
  const [overOnly, setOverOnly] = useState(false);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [entriesByMonth, setEntriesByMonth] = useState<Map<string, CompanyTimecardEntry[]>>(new Map());
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [exemptions, setExemptions] = useState<CorrectionExemption[]>([]);
  const [dialog, setDialog] = useState<ExemptDialog | null>(null);
  const [dialogReason, setDialogReason] = useState("");
  const [dialogSaving, setDialogSaving] = useState(false);

  useEffect(() => {
    getCompanyTimecardCorrections()
      .then(setCorrections)
      .catch(() => setCorrections([]));
    getCorrectionExemptions().then(setExemptions);
  }, []);

  const activeExemption = useMemo(() => {
    const map = new Map<string, CorrectionExemption>();
    for (const e of exemptions) if (!e.removedAt) map.set(e.correctionId, e);
    return map;
  }, [exemptions]);
  const exemptionHistory = useMemo(() => {
    const map = new Map<string, CorrectionExemption[]>();
    for (const e of exemptions) {
      if (!map.has(e.correctionId)) map.set(e.correctionId, []);
      map.get(e.correctionId)!.push(e);
    }
    return map;
  }, [exemptions]);

  const openDialog = (d: ExemptDialog) => {
    setDialogReason("");
    setDialog(d);
  };
  const dialogLabel = (d: ExemptDialog) => `${d.personName} — ${fmtDay(d.correction.workDate)}`;
  const saveDialog = async () => {
    if (!dialog) return;
    if (dialog.kind === "exempt" && !dialogReason.trim()) return;
    setDialogSaving(true);
    try {
      if (dialog.kind === "exempt") {
        const row = await exemptCorrection({ correctionId: dialog.correction.id, reason: dialogReason, byName: myName, label: dialogLabel(dialog) });
        setExemptions((prev) => [row, ...prev]);
        toast.success(`Exempted — ${dialog.personName}'s ${fmtDay(dialog.correction.workDate)} correction no longer counts.`);
      } else {
        await removeCorrectionExemption({
          exemptionId: dialog.exemption.id,
          correctionId: dialog.correction.id,
          reason: dialogReason,
          byName: myName,
          byProfileId: myProfileId,
          label: dialogLabel(dialog),
        });
        const now = new Date().toISOString();
        const removedId = dialog.exemption.id;
        setExemptions((prev) =>
          prev.map((e) => (e.id === removedId ? { ...e, removedAt: now, removedByName: myName, removedReason: dialogReason.trim() || null } : e))
        );
        toast.success("Exemption removed — the correction counts again.");
      }
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save — try again.");
    } finally {
      setDialogSaving(false);
    }
  };

  // A month's punches load once, the first time someone in it is opened.
  useEffect(() => {
    if (!openId || entriesByMonth.has(month)) return;
    let cancelled = false;
    setEntriesLoading(true);
    const { start, end } = monthBounds(month);
    getCompanyTimecardEntries(start, end)
      .then((rows) => {
        if (!cancelled) setEntriesByMonth((prev) => new Map(prev).set(month, rows));
      })
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openId, month, entriesByMonth]);

  const rows = useMemo<PersonRow[]>(() => {
    if (!corrections) return [];
    const { start, end } = monthBounds(month);
    const byProfile = new Map<string, TimecardCorrectionRow[]>();
    for (const c of corrections) {
      if (c.workDate < start || c.workDate > end) continue;
      if (!byProfile.has(c.profileId)) byProfile.set(c.profileId, []);
      byProfile.get(c.profileId)!.push(c);
    }
    const q = search.trim().toLowerCase();
    const out: PersonRow[] = [];
    for (const p of profiles) {
      if (!p.is_active) continue;
      const group = groupOf(p);
      if (!group) continue;
      if (q && !(p.display_name || p.email || "").toLowerCase().includes(q)) continue;
      const mine = (byProfile.get(p.id) ?? []).sort((a, b) => a.workDate.localeCompare(b.workDate));
      const exemptCount = mine.filter((c) => activeExemption.has(c.id)).length;
      const counted = mine.filter((c) => countsTowardLimit(c, activeExemption)).length;
      if (overOnly && counted <= MAX_CORRECTIONS_PER_MONTH) continue;
      out.push({ profile: p, group, corrections: mine, counted, exemptCount });
    }
    return out.sort(
      (a, b) => b.counted - a.counted || b.corrections.length - a.corrections.length || (a.profile.display_name || "").localeCompare(b.profile.display_name || "")
    );
  }, [corrections, profiles, month, search, overOnly, activeExemption]);

  const regionRows = rows.filter((r) => regionOf(r.group) === region);
  const overCount = (list: PersonRow[]) => list.filter((r) => r.counted > MAX_CORRECTIONS_PER_MONTH).length;

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-semibold">Exceeded Time Corrections</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Timecard corrections each person filed for {monthLabel(month)}, counted by the day being corrected. {MAX_CORRECTIONS_PER_MONTH} a month is the maximum — anyone over it is flagged. Rejected and exempt corrections don't count. Click a name to see their timecards for the month.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="glass-input" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Employee name..." className="glass-input w-full" />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer select-none">
          <input type="checkbox" checked={overOnly} onChange={(e) => setOverOnly(e.target.checked)} />
          Only over the limit
        </label>
      </div>

      <div className="mb-4 flex gap-2">
        {REGIONS.map(({ key: r, label }) => {
          const over = overCount(rows.filter((x) => regionOf(x.group) === r));
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              className={`btn btn-sm ${region === r ? "bg-primary/20 text-primary" : ""}`}
            >
              {label}
              {over > 0 && <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] font-bold text-red-300">{over}</span>}
            </button>
          );
        })}
      </div>

      {corrections === null ? (
        <TableSkeleton rows={6} cols={4} />
      ) : regionRows.length === 0 ? (
        <EmptyState
          compact
          title={overOnly ? "No one is over the limit" : "No employees to show"}
          hint={overOnly ? `Nobody in this list filed more than ${MAX_CORRECTIONS_PER_MONTH} corrections in ${monthLabel(month)}.` : undefined}
        />
      ) : (
        <div className="space-y-5">
          {GROUPS.filter((g) => g.region === region).map((g) => {
            const list = regionRows.filter((r) => r.group === g.key);
            if (list.length === 0) return null;
            const total = list.reduce((s, r) => s + r.counted, 0);
            return (
              <section key={g.key}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold">{g.label}</h3>
                  <span className="text-xs text-slate-400">
                    {list.length} {list.length === 1 ? "person" : "people"} · {total} {total === 1 ? "correction" : "corrections"}
                    {overCount(list) > 0 && <span className="text-red-300"> · {overCount(list)} over limit</span>}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Name</th>
                        <th className="px-3 py-2 font-semibold">{g.key === "PH" ? "Role" : "Branch"}</th>
                        <th className="px-3 py-2 font-semibold">Corrections</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const n = r.counted;
                        const over = n > MAX_CORRECTIONS_PER_MONTH;
                        const open = openId === r.profile.id;
                        const counts = { approved: 0, pending: 0, rejected: 0 } as Record<string, number>;
                        for (const c of r.corrections) counts[c.status] = (counts[c.status] ?? 0) + 1;
                        return (
                          <Fragment key={r.profile.id}>
                            <tr className={`border-b border-white/5 last:border-b-0 ${over ? "bg-red-500/[0.06]" : ""}`}>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => setOpenId(open ? null : r.profile.id)}
                                  className="inline-flex items-center gap-1 font-semibold hover:text-primary"
                                >
                                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  {r.profile.display_name || r.profile.email}
                                </button>
                              </td>
                              <td className="px-3 py-2 text-slate-300">
                                {g.key === "PH" ? ROLE_LABELS[normalizeRole(r.profile.role)] ?? r.profile.role : r.profile.assigned_branch || "—"}
                              </td>
                              <td className="px-3 py-2 tabular-nums">
                                <span className={`font-semibold ${over ? "text-red-300" : n === MAX_CORRECTIONS_PER_MONTH ? "text-amber-300" : ""}`}>{n}</span>
                                <span className="text-slate-500"> / {MAX_CORRECTIONS_PER_MONTH}</span>
                                {r.corrections.length > 0 && (
                                  <span className="ml-2 text-[11px] text-slate-400">
                                    {[
                                      ...(["approved", "pending", "rejected"] as const).filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`),
                                      ...(r.exemptCount > 0 ? [`${r.exemptCount} exempt`] : []),
                                    ].join(" · ")}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {over ? (
                                  <span className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                                    <Flag className="h-3 w-3" /> Over limit
                                  </span>
                                ) : n === MAX_CORRECTIONS_PER_MONTH ? (
                                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">At limit</span>
                                ) : (
                                  <span className="text-[11px] text-slate-500">OK</span>
                                )}
                              </td>
                            </tr>
                            {open && (
                              <tr className="border-b border-white/5 bg-black/30">
                                <td colSpan={4} className="px-3 py-3">
                                  <MonthTimecards
                                    month={month}
                                    profileId={r.profile.id}
                                    corrections={r.corrections}
                                    entries={entriesByMonth.get(month)}
                                    loading={entriesLoading && !entriesByMonth.has(month)}
                                    activeExemption={activeExemption}
                                    exemptionHistory={exemptionHistory}
                                    canExempt={canExempt}
                                    onExempt={(c) => openDialog({ kind: "exempt", correction: c, personName: r.profile.display_name || r.profile.email || "" })}
                                    onRemove={(c, e) => openDialog({ kind: "remove", correction: c, exemption: e, personName: r.profile.display_name || r.profile.email || "" })}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {dialog && (
        <AppModal
          size="sm"
          title={dialog.kind === "exempt" ? "Exempt this correction?" : "Remove exemption?"}
          description={`${dialogLabel(dialog)}${correctedTimes(dialog.correction) ? ` · ${correctedTimes(dialog.correction)}` : ""}`}
          busy={dialogSaving}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" onClick={() => setDialog(null)} disabled={dialogSaving} className="btn">
                Cancel
              </button>
              <button
                type="button"
                onClick={saveDialog}
                disabled={dialogSaving || (dialog.kind === "exempt" && !dialogReason.trim())}
                className={dialog.kind === "exempt" ? "btn btn-primary" : "btn btn-danger"}
              >
                {dialogSaving ? "Saving…" : dialog.kind === "exempt" ? "Exempt" : "Remove exemption"}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {dialog.kind === "exempt" ? (
              <p className="text-[13px] text-[var(--color-muted-foreground)]">
                It won't count toward their {MAX_CORRECTIONS_PER_MONTH}-a-month limit. Your name, the time and this reason are recorded.
              </p>
            ) : (
              <p className="text-[13px] text-[var(--color-muted-foreground)]">
                Exempted by {dialog.exemption.exemptedByName || "someone"} on {fmtStamp(dialog.exemption.exemptedAt)}: "{dialog.exemption.reason}". It will count toward their limit again; the exemption stays on record.
              </p>
            )}
            {dialog.correction.reason && (
              <p className="rounded-md border border-[var(--color-panel-border)] px-3 py-2 text-[13px]">
                <span className="font-semibold">Their reason:</span> {dialog.correction.reason}
              </p>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold">
                {dialog.kind === "exempt" ? "Why is this exempt?" : "Why remove it? (optional)"}
              </label>
              <textarea
                autoFocus
                rows={3}
                value={dialogReason}
                onChange={(e) => setDialogReason(e.target.value)}
                placeholder={dialog.kind === "exempt" ? "e.g. App outage on Oct 2 — no one at the branch could clock in" : ""}
                className="glass-input w-full rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}

function MonthTimecards({
  month,
  profileId,
  corrections,
  entries,
  loading,
  activeExemption,
  exemptionHistory,
  canExempt,
  onExempt,
  onRemove,
}: {
  month: string;
  profileId: string;
  corrections: TimecardCorrectionRow[];
  entries: CompanyTimecardEntry[] | undefined;
  loading: boolean;
  activeExemption: Map<string, CorrectionExemption>;
  exemptionHistory: Map<string, CorrectionExemption[]>;
  canExempt: boolean;
  onExempt: (c: TimecardCorrectionRow) => void;
  onRemove: (c: TimecardCorrectionRow, e: CorrectionExemption) => void;
}) {
  if (loading || !entries) return <p className="text-xs text-slate-400">Loading timecards…</p>;
  const mine = entries.filter((e) => e.profileId === profileId).sort((a, b) => a.workDate.localeCompare(b.workDate));
  const correctionByDay = new Map<string, TimecardCorrectionRow[]>();
  for (const c of corrections) {
    if (!correctionByDay.has(c.workDate)) correctionByDay.set(c.workDate, []);
    correctionByDay.get(c.workDate)!.push(c);
  }
  // Days with a correction but no punch row still belong in the list.
  const days = Array.from(new Set([...mine.map((e) => e.workDate), ...correctionByDay.keys()])).sort();
  const entryByDay = new Map(mine.map((e) => [e.workDate, e]));

  let workedMinutes = 0;
  let daysWorked = 0;
  for (const e of mine) {
    if (!e.checkIn) continue;
    daysWorked++;
    const shift = correctionShiftMinutes(e.checkIn, e.checkOut);
    const meal = correctionShiftMinutes(e.mealStart, e.mealEnd) ?? 0;
    if (shift !== null) workedMinutes += Math.max(0, shift - meal);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-300">
        <span>
          <strong>{monthLabel(month)}</strong>
        </span>
        <span>Days worked: <strong className="tabular-nums">{daysWorked}</strong></span>
        <span>Hours: <strong className="tabular-nums">{formatShift(workedMinutes)}</strong></span>
        <span>Corrections: <strong className="tabular-nums">{corrections.length}</strong></span>
        {corrections.some((c) => !countsTowardLimit(c, activeExemption)) && (
          <span>Counted: <strong className="tabular-nums">{corrections.filter((c) => countsTowardLimit(c, activeExemption)).length}</strong></span>
        )}
      </div>
      {days.length === 0 ? (
        <p className="text-xs text-slate-400">No timecards this month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">Date</th>
                <th className="px-2 py-1.5 font-semibold">Time In</th>
                <th className="px-2 py-1.5 font-semibold">Meal</th>
                <th className="px-2 py-1.5 font-semibold">Time Out</th>
                <th className="px-2 py-1.5 font-semibold">Hours</th>
                <th className="px-2 py-1.5 font-semibold">Correction</th>
                <th className="px-2 py-1.5 font-semibold">Reason</th>
                <th className="px-2 py-1.5 font-semibold">Exempt</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const e = entryByDay.get(day);
                const fixes = correctionByDay.get(day) ?? [];
                const shift = e ? correctionShiftMinutes(e.checkIn, e.checkOut) : null;
                const meal = e ? correctionShiftMinutes(e.mealStart, e.mealEnd) ?? 0 : 0;
                return (
                  <tr key={day} className={`border-t border-white/5 ${fixes.length ? "bg-amber-500/[0.05]" : ""}`}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtDay(day)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{e ? to12h(e.checkIn) : "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{e && e.mealStart ? `${to12h(e.mealStart)} – ${to12h(e.mealEnd)}` : "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{e ? to12h(e.checkOut) : "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{shift !== null ? formatShift(Math.max(0, shift - meal)) : "—"}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-col items-start gap-1">
                        {fixes.map((c) => (
                          <span
                            key={c.id}
                            className={`whitespace-nowrap rounded border px-1.5 py-px text-[10px] font-semibold ${STATUS_STYLE[c.status] ?? ""} ${countsTowardLimit(c, activeExemption) ? "" : "opacity-50"}`}
                          >
                            <span className="capitalize">{c.status}</span>
                            {correctedTimes(c) ? ` · ${correctedTimes(c)}` : ""}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 min-w-[220px] max-w-[420px]">
                      <div className="flex flex-col gap-1">
                        {fixes.map((c) => {
                          const issue = issueLabel(c);
                          return (
                            <div key={c.id} className="leading-snug">
                              {issue && <span className="mr-1 font-semibold text-slate-200">{issue}{c.reason ? ":" : ""}</span>}
                              <span className="text-slate-300">{c.reason || (issue ? "" : "—")}</span>
                              {c.status === "rejected" && c.reviewNote && <div className="text-[10px] text-red-300/90">{c.reviewNote}</div>}
                            </div>
                          );
                        })}
                        {fixes.length === 0 && <span className="text-slate-500">—</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 min-w-[220px] max-w-[360px]">
                      <div className="flex flex-col gap-1.5">
                        {fixes.map((c) => {
                          const active = activeExemption.get(c.id);
                          const removed = (exemptionHistory.get(c.id) ?? []).filter((x) => x.removedAt);
                          return (
                            <div key={c.id} className="space-y-0.5">
                              {active ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold text-sky-300">
                                    <ShieldCheck className="h-3 w-3" /> Exempt
                                  </span>
                                  {canExempt && (
                                    <button type="button" onClick={() => onRemove(c, active)} className="btn btn-ghost btn-sm !h-6 !px-1.5 text-[11px]" title="Remove exemption">
                                      <Undo2 className="!h-3 !w-3" /> Undo
                                    </button>
                                  )}
                                </div>
                              ) : canExempt && c.status !== "rejected" ? (
                                <button type="button" onClick={() => onExempt(c)} className="btn btn-sm !h-6 !px-2 text-[11px]">
                                  <ShieldCheck className="!h-3 !w-3" /> Exempt
                                </button>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                              {active && (
                                <div className="text-[10px] leading-snug text-slate-400">
                                  "{active.reason}" — {active.exemptedByName || "Unknown"}, {fmtStamp(active.exemptedAt)}
                                </div>
                              )}
                              {removed.map((x) => (
                                <div key={x.id} className="text-[10px] leading-snug text-slate-500">
                                  Was exempt ("{x.reason}" — {x.exemptedByName || "Unknown"}, {fmtStamp(x.exemptedAt)}); removed by {x.removedByName || "Unknown"}, {fmtStamp(x.removedAt!)}
                                  {x.removedReason ? `: "${x.removedReason}"` : ""}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {fixes.length === 0 && <span className="text-slate-500">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
