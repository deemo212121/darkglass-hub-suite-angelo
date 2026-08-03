/**
 * HR & Recruitment Report — read-only summary, distinct from HR &
 * Recruitment Dashboard (ReportHRDaily.tsx — despite the filename, that
 * component IS the full interactive dashboard: Add Candidate, CV upload/
 * forwarding, Employee Directory editing, Jotform submission processing,
 * Onboarding Documents management, EOD/EOM report generation). This page
 * reuses the same real read-only fetchers (getCandidates, getCompanyUsers,
 * getAllAgentNotes) so the numbers agree, but never writes anything.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Users, UserCheck, UserX, Clock, Briefcase, Loader2, Download } from "lucide-react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { getCandidates, type Candidate, type CandidateStatus } from "@/lib/supabase/hrCandidates";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";

const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" } as const;

const STATUS_ORDER: CandidateStatus[] = ["applied", "interviewing", "selected", "training", "on_hold", "hired", "rejected"];
const STATUS_LABEL: Record<CandidateStatus, string> = {
  applied: "Applied",
  interviewing: "Interviewing",
  selected: "Selected",
  training: "Training",
  on_hold: "On Hold",
  hired: "Hired",
  rejected: "Rejected",
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
function dateOnly(v: string | undefined | null): string { return (v || "").slice(0, 10); }

export function ReportHR({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(29));
  const [dateTo, setDateTo] = useState(todayIso());
  const [branchFilter, setBranchFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [companyUsers, cands, allNotes] = await Promise.all([
          getCompanyUsers(),
          getCandidates(),
          getAllAgentNotes().catch((err) => { console.error("Failed to load agent notes:", err); return []; }),
        ]);
        if (cancelled) return;
        setProfiles(companyUsers);
        setCandidates(cands);
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load HR & Recruitment Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const branchOptions = useMemo(() => Array.from(new Set(candidates.map((c) => c.branch).filter((b): b is string => !!b))).sort(), [candidates]);

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      const d = dateOnly(c.createdAt);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      if (branchFilter && c.branch !== branchFilter) return false;
      return true;
    });
  }, [candidates, dateFrom, dateTo, branchFilter]);

  const kpi = useMemo(() => {
    const byStatus = new Map<CandidateStatus, number>();
    for (const c of filteredCandidates) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
    return {
      totalEmployees: profiles.length,
      totalCandidates: filteredCandidates.length,
      interviewing: byStatus.get("interviewing") ?? 0,
      hired: byStatus.get("hired") ?? 0,
      rejected: byStatus.get("rejected") ?? 0,
      onHold: byStatus.get("on_hold") ?? 0,
    };
  }, [filteredCandidates, profiles]);

  const statusBreakdown = useMemo(() => {
    return STATUS_ORDER.map((s) => ({
      status: s,
      label: STATUS_LABEL[s],
      count: filteredCandidates.filter((c) => c.status === s).length,
    }));
  }, [filteredCandidates]);

  // Headcount by role — real profiles.department is rarely populated, role
  // is the real department-like dimension (same convention established on
  // AccountingDashboard.tsx / ReportAttendanceMonitoring.tsx).
  const headcountByRole = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of profiles) {
      const label = ROLE_LABELS[normalizeRole(p.role)] ?? p.role ?? "Unspecified";
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count);
  }, [profiles]);

  // Only approved notes count as an employee's official record — same rule
  // used everywhere else this workflow shows up.
  const warningsByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) { if (n.status !== "approved" || n.type !== "warning") continue; map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1); }
    return map;
  }, [notes]);
  const mistakesByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) { if (n.status !== "approved" || n.type !== "mistake") continue; map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1); }
    return map;
  }, [notes]);
  const totalWarnings = useMemo(() => profiles.reduce((s, p) => s + (warningsByProfile.get(p.id) ?? 0), 0), [profiles, warningsByProfile]);
  const totalMistakes = useMemo(() => profiles.reduce((s, p) => s + (mistakesByProfile.get(p.id) ?? 0), 0), [profiles, mistakesByProfile]);

  const exportToXlsx = () => {
    const sheet: (string | number)[][] = [
      ["HR & Recruitment Report"],
      [`Period: ${dateFrom} to ${dateTo}`],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      ["Summary"],
      ["Metric", "Value"],
      ["Total Employees", kpi.totalEmployees],
      ["Total Candidates", kpi.totalCandidates],
      ["Interviewing", kpi.interviewing],
      ["Hired", kpi.hired],
      ["Rejected", kpi.rejected],
      ["On Hold", kpi.onHold],
      ["Warnings", totalWarnings],
      ["Mistakes", totalMistakes],
      [],
      ["Hiring Pipeline by Status"],
      ["Status", "Count"],
      ...statusBreakdown.map((s) => [s.label, s.count]),
      [],
      ["Headcount by Role"],
      ["Role", "Count"],
      ...headcountByRole.map((r) => [r.role, r.count]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "HR Report");
    XLSX.writeFile(workbook, `hr-recruitment-report_${dateFrom}_to_${dateTo}.xlsx`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-2xl font-bold">{sub.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Read-only hiring &amp; headcount summary — manage candidates, onboarding, and Jotform submissions from the HR &amp; Recruitment Dashboard.</p>
          </div>
        </div>

        <div className="panel p-4 mb-6"><div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Branch</label>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md">
              <option value="">All Branches</option>
              {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select></div>
          <button onClick={exportToXlsx} disabled={loading} className="btn text-sm px-3 mb-0.5 flex items-center gap-1.5 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> Download XLSX
          </button>
        </div></div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading HR &amp; Recruitment Report…</div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          {[
            ["Total Employees", kpi.totalEmployees, "text-white", Users],
            ["Candidates", kpi.totalCandidates, "text-blue-300", Briefcase],
            ["Interviewing", kpi.interviewing, "text-yellow-300", Clock],
            ["Hired", kpi.hired, "text-green-300", UserCheck],
            ["Rejected", kpi.rejected, "text-red-300", UserX],
            ["On Hold", kpi.onHold, "text-orange-300", Clock],
          ].map(([label, value, color, Icon]: any) => (
            <div key={label} className="panel p-3 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground"><Icon className="h-4 w-4" /></div>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Hiring Pipeline by Status</p>
            {filteredCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No candidates in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={statusBreakdown} margin={{ left: -10 }}>
                  <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Candidates" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="panel p-4">
            <p className="text-sm font-semibold mb-4">Headcount by Role</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={headcountByRole.slice(0, 10)} margin={{ left: -10 }}>
                <XAxis dataKey="role" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-25} textAnchor="end" height={50} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="count" fill="#34d399" radius={[4, 4, 0, 0]} name="Employees" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ["Warnings (Company-wide)", totalWarnings, "text-yellow-300"],
            ["Mistakes (Company-wide)", totalMistakes, "text-red-300"],
          ].map(([label, value, color]: any) => (
            <div key={label} className="panel p-3 text-center"><p className={`text-lg font-bold ${color}`}>{value}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p></div>
          ))}
        </div>
        </>
        )}
      </main>
    </div>
  );
}
