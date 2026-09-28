/**
 * Reschedule Requests — CSR's daily view of technician-reported ticket
 * reschedules, replacing a manual spreadsheet worksheet (Date/Area/
 * Technician/Total/Resched/Phone DX/Rerouted/Notes columns). Read-only for
 * CSR: no approve/reject here — that stays on the Ticket Time Dispute
 * review flow (TicketTimeDisputesTab.tsx etc.), which is a signed,
 * multi-stage approval process this page has nothing to do with. CSR can
 * only view the day's reschedules and annotate Phone DX / Rerouted /
 * Notes, which have no other data source in the app (migration 0308).
 *
 * Only lists technicians who actually have at least one reschedule-mode
 * Ticket Time Dispute submission (employee_requests.dispute_mode =
 * 'reschedule', migration 0307) for the selected date — matched on
 * rescheduleActualDay, the day the technician reported the reschedule
 * affected, not the request's createdAt or the ticket's (mutable)
 * schedule_date. "Total" is that technician's full route size for the
 * same date (getTicketAttendanceForTechnician), for context alongside how
 * many of those got rescheduled.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useSmartBack } from "@/hooks/useSmartBack";
import { useAuth } from "@/lib/auth";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getProfileIdByFirebaseUid } from "@/lib/supabase/timecards";
import { getCompanyEmployeeRequests, type EmployeeRequestRow } from "@/lib/supabase/employeeRequests";
import { getTicketAttendanceForTechnician } from "@/lib/supabase/technicianWhereabouts";
import {
  getCsrRescheduleDailyNotes,
  upsertCsrRescheduleDailyNote,
  type CsrRescheduleDailyNoteRow,
} from "@/lib/supabase/csrRescheduleNotes";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface TechRow {
  technician: string;
  profileId: string | null;
  area: string;
  total: number;
  resched: number;
  requests: EmployeeRequestRow[];
}

export function CsrRescheduleRequestsPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const { uid, displayName } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [requests, setRequests] = useState<EmployeeRequestRow[]>([]);
  const [notes, setNotes] = useState<Map<string, CsrRescheduleDailyNoteRow>>(new Map());
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [profileRows, requestRows, noteMap] = await Promise.all([
          getCompanyUsers(),
          getCompanyEmployeeRequests(),
          getCsrRescheduleDailyNotes(selectedDate),
        ]);
        if (cancelled) return;
        setProfiles(profileRows);
        const dayReschedules = requestRows.filter(
          (r) => r.requestType === "ticket_time_dispute" && r.disputeMode === "reschedule" && r.rescheduleActualDay === selectedDate
        );
        setRequests(dayReschedules);
        setNotes(noteMap);

        // Total = that technician's full route size for the same date —
        // one scoped query per technician with a reschedule (not a
        // company-wide scan), same helper Ticket Attendance itself uses.
        const byProfile = new Map<string, EmployeeRequestRow[]>();
        for (const r of dayReschedules) {
          const arr = byProfile.get(r.profileId);
          if (arr) arr.push(r);
          else byProfile.set(r.profileId, [r]);
        }
        const totalEntries = await Promise.all(
          Array.from(byProfile.keys()).map(async (profileId) => {
            const p = profileRows.find((x) => x.id === profileId);
            const name = p?.display_name || p?.email || "";
            if (!name) return [profileId, 0] as const;
            const rows = await getTicketAttendanceForTechnician(name, selectedDate, selectedDate);
            return [profileId, rows.length] as const;
          })
        );
        if (cancelled) return;
        setTotals(new Map(totalEntries));
      } catch (err) {
        console.error("CsrRescheduleRequestsPage: load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const techRows: TechRow[] = useMemo(() => {
    const byProfile = new Map<string, EmployeeRequestRow[]>();
    for (const r of requests) {
      const arr = byProfile.get(r.profileId);
      if (arr) arr.push(r);
      else byProfile.set(r.profileId, [r]);
    }
    return Array.from(byProfile.entries())
      .map(([profileId, reqs]) => {
        const p = profileById.get(profileId);
        const technician = p?.display_name || p?.email || reqs[0]?.employeeSignatureName || "Unknown";
        return {
          technician,
          profileId,
          area: p?.assigned_branch || "",
          total: totals.get(profileId) ?? 0,
          resched: reqs.length,
          requests: reqs,
        };
      })
      .sort((a, b) => a.technician.localeCompare(b.technician));
  }, [requests, profileById, totals]);

  const handleNoteChange = async (row: TechRow, field: "phoneDx" | "rerouted" | "notes", value: number | string) => {
    const key = row.technician;
    const existing = notes.get(key);
    const next: CsrRescheduleDailyNoteRow = {
      id: existing?.id ?? "",
      workDate: selectedDate,
      technician: row.technician,
      area: row.area || null,
      phoneDx: existing?.phoneDx ?? 0,
      rerouted: existing?.rerouted ?? 0,
      notes: existing?.notes ?? "",
      updatedBy: myProfileId,
      updatedAt: new Date().toISOString(),
      [field]: value,
    } as CsrRescheduleDailyNoteRow;
    setNotes((prev) => new Map(prev).set(key, next));
    setSavingKey(key);
    try {
      const saved = await upsertCsrRescheduleDailyNote({
        workDate: selectedDate,
        technician: row.technician,
        area: row.area || null,
        phoneDx: next.phoneDx,
        rerouted: next.rerouted,
        notes: next.notes,
        updatedBy: myProfileId,
      });
      setNotes((prev) => new Map(prev).set(key, saved));
    } catch (err) {
      console.error("Failed to save reschedule note:", err);
      alert(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <button type="button" onClick={goBack} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </button>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        <div className="panel p-6">
          <div className="info-banner mb-6" style={{ background: "rgba(96, 165, 250, 0.1)", border: "1px solid rgba(96, 165, 250, 0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#93c5fd", fontSize: "0.85rem", lineHeight: 1.5 }}>
            <strong>📋 View only.</strong> This lists technicians who reported a same-day reschedule via Ticket Time Dispute — you can't approve or sign here (that's on the dispute's own review flow), just view the details and add Phone DX / Rerouted / Notes.
          </div>

          <div className="mb-6 flex items-center gap-3">
            <label className="text-sm font-semibold text-slate-300">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="glass-input py-1.5 px-3 text-sm"
            />
          </div>

          {loading ? (
            <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
          ) : techRows.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">No reschedule requests reported for {selectedDate}.</div>
          ) : (
            <div className="overflow-x-auto border border-white/10 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-blue-900/50 border-b border-blue-500/30">
                    <th className="px-3 py-3 text-left text-xs font-semibold text-blue-300">Date</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-blue-300">Area</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-blue-300">Technician</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-blue-300">Total</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-blue-300">Resched</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-blue-300">Phone DX</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-blue-300">Rerouted</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-blue-300">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {techRows.map((row) => {
                    const note = notes.get(row.technician);
                    const saving = savingKey === row.technician;
                    return (
                      <tr key={row.profileId ?? row.technician} className="border-b border-white/5 hover:bg-white/5 transition-colors align-top">
                        <td className="px-3 py-3 text-slate-300">{selectedDate}</td>
                        <td className="px-3 py-3 text-slate-300">{row.area || "—"}</td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-white">{row.technician}</p>
                          <div className="mt-1 space-y-0.5">
                            {row.requests.map((r) => (
                              <p key={r.id} className="text-[11px] text-slate-400">
                                <a href={`/ticket/${r.ticketNo}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline font-mono">
                                  {r.ticketNo}
                                </a>
                                {r.details ? ` — ${r.details}` : ""}
                              </p>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center text-slate-300">{row.total}</td>
                        <td className="px-3 py-3 text-center font-semibold text-sky-300">{row.resched}</td>
                        <td className="px-3 py-3 text-center">
                          <input
                            type="number"
                            min={0}
                            defaultValue={note?.phoneDx ?? 0}
                            onBlur={(e) => handleNoteChange(row, "phoneDx", Number(e.target.value) || 0)}
                            className="w-16 bg-slate-800/50 border border-white/10 rounded px-2 py-1 text-center text-white text-sm focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-3 text-center">
                          <input
                            type="number"
                            min={0}
                            defaultValue={note?.rerouted ?? 0}
                            onBlur={(e) => handleNoteChange(row, "rerouted", Number(e.target.value) || 0)}
                            className="w-16 bg-slate-800/50 border border-white/10 rounded px-2 py-1 text-center text-white text-sm focus:border-blue-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="text"
                            defaultValue={note?.notes ?? ""}
                            onBlur={(e) => handleNoteChange(row, "notes", e.target.value)}
                            placeholder="Add a note…"
                            className="w-full min-w-[160px] bg-slate-800/50 border border-white/10 rounded px-2 py-1 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                          />
                          {saving && <span className="text-[10px] text-slate-500">Saving…</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
