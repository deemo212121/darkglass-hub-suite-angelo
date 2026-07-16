import { useState, useMemo, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import * as XLSX from "xlsx";
import { ChevronLeft, Loader2, Users, AlertTriangle, Download } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import type { Ticket } from "@/lib/ticketData";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import { normalizeRole, ROLE_LABELS } from "@/lib/roleLabels";
import { REGIONS, REGION_LOCATIONS } from "@/lib/locations";
import { ReportBranchBase } from "./ReportBranchBase";
import { ReportCancellations } from "./ReportCancellations";

// Operations staff — BizOps Manager / Senior Manager roles, same live-staff
// pattern used on Claims/Parts Dashboards (real profiles + real
// Warnings/Mistakes from the company-wide notes workflow, not a hardcoded
// name list). Checks both the primary role AND extra_roles (profiles.
// extra_roles, migration 0020) — this app supports dual-role users (e.g. a
// CSR Agent who is also a BizOps Manager), and every comparable roster
// elsewhere (CSR Team Leader Dashboard, CSR Dashboard, HR) ORs both fields.
const BIZOPS_ROLES = new Set(["BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER"]);

function isBizOpsProfile(p: ProfileRow): boolean {
  if (BIZOPS_ROLES.has(normalizeRole(p.role))) return true;
  return (p.extra_roles || []).some((r) => BIZOPS_ROLES.has(normalizeRole(r)));
}

const ALL_REGION_GROUPS = REGIONS.map((region) => ({ region, locations: REGION_LOCATIONS[region] }));

type TabKey = "overview" | "east" | "west" | "central" | "cancellations";

function exportStaffToXlsx(rows: { name: string; role: string; branch: string; warnings: number; mistakes: number }[]) {
  const data = rows.map((r) => ({
    Name: r.name,
    Role: r.role,
    Branch: r.branch,
    Warnings: r.warnings,
    Mistakes: r.mistakes,
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "BizOps Staff");
  XLSX.writeFile(workbook, `operations-bizops-staff_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function ReportOperationsDaily({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState<ProfileRow[]>([]);
  const [notes, setNotes] = useState<CsrAgentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [ticketData, profiles, allNotes] = await Promise.all([
          getCompanyTickets(),
          getCompanyUsers(),
          getAllAgentNotes().catch((err) => {
            console.error("Failed to load agent notes:", err);
            return [];
          }),
        ]);
        if (cancelled) return;
        setTickets(ticketData);
        setStaff(profiles.filter(isBizOpsProfile));
        setNotes(allNotes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load Operations Daily Report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Only approved notes count as an employee's official record — same rule
  // used everywhere else this workflow shows up (CSR/Claims/Parts dashboards).
  const warningCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.status !== "approved" || n.type !== "warning") continue;
      map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1);
    }
    return map;
  }, [notes]);
  const mistakeCountByProfile = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.status !== "approved" || n.type !== "mistake") continue;
      map.set(n.agentProfileId, (map.get(n.agentProfileId) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const staffRows = useMemo(() => {
    return staff
      .map((p) => ({
        id: p.id,
        name: p.display_name || p.username || p.email,
        role: ROLE_LABELS[normalizeRole(p.role)] ?? p.role,
        branch: p.assigned_branch || "—",
        warnings: warningCountByProfile.get(p.id) ?? 0,
        mistakes: mistakeCountByProfile.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.warnings + b.mistakes - (a.warnings + a.mistakes));
  }, [staff, warningCountByProfile, mistakeCountByProfile]);

  const totalWarnings = staffRows.reduce((s, r) => s + r.warnings, 0);
  const totalMistakes = staffRows.reduce((s, r) => s + r.mistakes, 0);

  const TABS: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "east", label: "Eastern TX Daily Report" },
    { key: "west", label: "Western TX Daily Report" },
    { key: "central", label: "Central TX Daily Report" },
    { key: "cancellations", label: "Need Cancel / Cancelled" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>

        <div className="flex gap-1 mb-6 border-b border-white/10">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        ) : loading ? (
          <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Operations Daily Report…
          </div>
        ) : (
          <>
            {activeTab === "overview" && (
              <>
                <p className="text-xs text-muted-foreground mb-4">Overall status across all regions and locations — Eastern, Western, and Central TX combined.</p>
                <ReportBranchBase tickets={tickets} regionGroups={ALL_REGION_GROUPS} exportFilePrefix="operations-overview" />

                <div className="flex items-center justify-between mt-8 mb-3">
                  <h2 className="text-lg font-semibold">BizOps Staff</h2>
                  <button onClick={() => exportStaffToXlsx(staffRows)} className="btn text-sm px-3 flex items-center gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download XLSX
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                  {[
                    { label: "BizOps Staff", value: staffRows.length, color: "text-blue-300", icon: <Users className="h-4 w-4" /> },
                    { label: "Warnings", value: totalWarnings, color: "text-yellow-300", icon: <AlertTriangle className="h-4 w-4" /> },
                    { label: "Mistakes", value: totalMistakes, color: "text-orange-300", icon: <AlertTriangle className="h-4 w-4" /> },
                  ].map((k) => (
                    <div key={k.label} className="panel p-4 text-center">
                      <div className="flex justify-center mb-1 text-muted-foreground">{k.icon}</div>
                      <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{k.label}</p>
                    </div>
                  ))}
                </div>

                <div className="panel p-0 overflow-hidden">
                  <div className="px-4 py-4 border-b border-white/10">
                    <h3 className="font-semibold text-sm">BizOps Staff</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Everyone currently holding a BizOps Manager or BizOps Senior Manager role — click a name for their full stats, mistakes &amp; warnings.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-white/5 border-b border-white/10">
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Name</th>
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Role</th>
                          <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Branch</th>
                          <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Warnings</th>
                          <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Mistakes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffRows.length === 0 ? (
                          <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No one currently holds a BizOps Manager or BizOps Senior Manager role.</td></tr>
                        ) : staffRows.map((s) => (
                          <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                            <td className="px-3 py-2 font-medium">
                              <a href={`/csr-agent/${s.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300 hover:underline transition" title={`View ${s.name}'s statistics`}>
                                {s.name}
                              </a>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{s.role}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.branch}</td>
                            <td className="px-3 py-2 text-right">
                              {s.warnings > 0 ? <span className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded font-semibold">{s.warnings}</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {s.mistakes > 0 ? <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded font-semibold">{s.mistakes}</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {activeTab === "east" && <ReportBranchBase tickets={tickets} regionGroups={[{ region: "EAST", locations: REGION_LOCATIONS.EAST }]} exportFilePrefix="operations-eastern-tx" />}
            {activeTab === "west" && <ReportBranchBase tickets={tickets} regionGroups={[{ region: "WEST", locations: REGION_LOCATIONS.WEST }]} exportFilePrefix="operations-western-tx" />}
            {activeTab === "central" && <ReportBranchBase tickets={tickets} regionGroups={[{ region: "CENTRAL", locations: REGION_LOCATIONS.CENTRAL }]} exportFilePrefix="operations-central-tx" />}
            {activeTab === "cancellations" && <ReportCancellations tickets={tickets} />}
          </>
        )}
      </main>
    </div>
  );
}
