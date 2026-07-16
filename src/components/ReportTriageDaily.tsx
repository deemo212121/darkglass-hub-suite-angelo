/**
 * Triage Daily Report — rebuilt on live data. "Triage" is the TR- prefixed
 * status family a ticket passes through (TR-Need Triage, TR-Need PO).
 * Remaining is a live snapshot of tickets currently in a TR- status.
 * Completed and Avg Triage Time are computed from ticket_audit_log (the
 * real trigger-written status-change trail): for each ticket, find the
 * timestamp it entered a TR- status and the timestamp it left one — the
 * delta is real triage duration, attributed to whoever moved it out.
 *
 * The old mock's HR/Work Hours/Rate/Covered Locations/Sick Day/Vacation Day
 * columns have no backing anywhere in this app (no shift/time-off system) —
 * dropped, matching the same precedent as Operations Daily Report's
 * "Training" column.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2, Users, CheckCircle2, Clock, Timer } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTickets, getTicketAuditLog } from "@/lib/supabase/tickets";
import type { Ticket } from "@/lib/ticketData";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole } from "@/lib/roleLabels";

const TRIAGE_ROLES = new Set(["TRIAGE_USER", "TRIAGE_MANAGER"]);
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, color: "#0f172a", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" } as const;

function isTriageProfile(p: ProfileRow): boolean {
  if (TRIAGE_ROLES.has(normalizeRole(p.role))) return true;
  return (p.extra_roles || []).some((r) => TRIAGE_ROLES.has(normalizeRole(r)));
}
function isTriageStatus(status: string | undefined | null): boolean {
  return String(status || "").trim().toLowerCase().startsWith("tr-");
}
function dateOnly(v: string | undefined | null): string {
  return (v || "").slice(0, 10);
}
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
/** Add (or subtract, with a negative n) n days to an ISO date string. */
const addDaysToIso = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtShort = (iso: string) => { const [, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}`; };
function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return `${hrs}h ${rem}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

interface ExitEvent { ticketId: string; agentId: string | null; exitAt: string; durationMs: number | null }

// Walk each ticket's status-change history (sorted chronologically) and
// find every "left a TR- status" event, pairing it with the most recent
// "entered a TR- status" event for that same ticket to get a real duration.
function computeTriageExits(auditRows: { ticketId: string; field: string; beforeValue: string | null; afterValue: string | null; changedBy: string | null; createdAt: string }[]): ExitEvent[] {
  const byTicket = new Map<string, typeof auditRows>();
  for (const r of auditRows) {
    if (r.field !== "status") continue;
    if (!byTicket.has(r.ticketId)) byTicket.set(r.ticketId, []);
    byTicket.get(r.ticketId)!.push(r);
  }

  const exits: ExitEvent[] = [];
  for (const [ticketId, rows] of byTicket) {
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let enteredAt: string | null = null;
    for (const r of rows) {
      const wasTriage = isTriageStatus(r.beforeValue);
      const isTriage = isTriageStatus(r.afterValue);
      if (!wasTriage && isTriage) {
        enteredAt = r.createdAt;
      } else if (wasTriage && !isTriage) {
        exits.push({
          ticketId,
          agentId: r.changedBy,
          exitAt: r.createdAt,
          durationMs: enteredAt ? new Date(r.createdAt).getTime() - new Date(enteredAt).getTime() : null,
        });
        enteredAt = null;
      }
    }
  }
  return exits;
}

export function ReportTriageDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);
  const [exits, setExits] = useState<ExitEvent[]>([]);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(29));
  const [dateTo, setDateTo] = useState(todayIso());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        // Widen the audit-log lookback so a ticket that entered triage before
        // dateFrom but exited inside the range still gets a real duration —
        // only exits inside [dateFrom, dateTo] are actually counted below.
        const lookbackStart = addDaysToIso(dateFrom, -60);
        const [allTickets, profiles, allNotes, auditLog] = await Promise.all([
          getCompanyTickets(),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => { console.error("Failed to load agent notes:", err); return []; }),
          getTicketAuditLog({ startDate: lookbackStart, endDate: dateTo }).catch((err) => { console.error("Failed to load audit log:", err); return []; }),
        ]);
        if (cancelled) return;
        setTickets(allTickets);
        setStaff(profiles.filter(isTriageProfile));
        setNotes(allNotes);
        setExits(computeTriageExits(auditLog));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Triage Daily Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const remainingTickets = useMemo(() => tickets.filter((t) => isTriageStatus(t.status)), [tickets]);
  const exitsInRange = useMemo(() => exits.filter((e) => dateOnly(e.exitAt) >= dateFrom && dateOnly(e.exitAt) <= dateTo), [exits, dateFrom, dateTo]);

  const withDuration = exitsInRange.filter((e) => e.durationMs !== null);
  const avgDurationMs = withDuration.length > 0 ? withDuration.reduce((s, e) => s + (e.durationMs ?? 0), 0) / withDuration.length : null;

  const kpi = {
    completed: exitsInRange.length,
    remaining: remainingTickets.length,
    staff: staff.length,
    avgTime: avgDurationMs !== null ? fmtDuration(avgDurationMs) : "—",
  };

  // Real day-by-day Completed count for the 10 days ending at Date To — not
  // the real "today", so this stays consistent with the KPI tiles when the
  // user looks at a past date range instead of the current one.
  const trendData = useMemo(() => {
    const dates = Array.from({ length: 10 }, (_, i) => addDaysToIso(dateTo, i - 9));
    const counts = new Map(dates.map((d) => [d, 0]));
    for (const e of exits) {
      const d = dateOnly(e.exitAt);
      if (counts.has(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return dates.map((d) => ({ date: fmtShort(d), completed: counts.get(d) ?? 0 }));
  }, [exits, dateTo]);

  const warningCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) { if (n.status !== "approved" || n.type !== "warning") continue; map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1); }
    return map;
  }, [notes]);
  const mistakeCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) { if (n.status !== "approved" || n.type !== "mistake") continue; map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1); }
    return map;
  }, [notes]);

  const totalWarnings = staff.reduce((s, p) => s + (warningCountByProfile.get(p.id) ?? 0), 0);
  const totalMistakes = staff.reduce((s, p) => s + (mistakeCountByProfile.get(p.id) ?? 0), 0);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        <div className="panel mb-6"><div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">Remaining reflects tickets currently in a TR- status (a live snapshot); Completed/Avg Triage Time are scoped to Date From–To.</p>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="panel p-8 mb-6 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Triage Daily Report…</div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Completed", value: kpi.completed, color: "text-green-300", icon: <CheckCircle2 className="h-4 w-4" /> },
            { label: "Remaining", value: kpi.remaining, color: "text-yellow-300", icon: <Clock className="h-4 w-4" /> },
            { label: "Triage Staff", value: kpi.staff, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
            { label: "Avg Triage Time", value: kpi.avgTime, color: "text-purple-300", icon: <Timer className="h-4 w-4" /> },
          ].map((k) => (
            <div key={k.label} className="panel p-4 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        <div className="panel p-4 mb-4">
          <p className="text-sm font-semibold mb-4">Completed — Last 10 Days</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trendData} margin={{ left: -10 }}>
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="completed" fill="#34d399" radius={[4, 4, 0, 0]} name="Completed" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            ["Triage Staff", kpi.staff, "text-blue-300"],
            ["Warnings (Company-wide)", totalWarnings, "text-yellow-300"],
            ["Mistakes (Company-wide)", totalMistakes, "text-red-300"],
          ].map(([l, v, c]) => (
            <div key={l as string} className="panel p-3 text-center"><p className={`text-lg font-bold ${c}`}>{v}</p><p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{l}</p></div>
          ))}
        </div>
        </>
        )}
      </main>
    </div>
  );
}
