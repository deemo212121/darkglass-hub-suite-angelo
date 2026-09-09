/**
 * HR module -> Technician Form Checklist. Per-technician live status of
 * every Technician-tab signable form (Wage Ack, Car IQ Agreement, Vehicle
 * Use Agreement, ...) — pulled straight from hr_signable_documents via
 * getAllSignableDocuments, not a separately-tracked checklist. Unlike
 * HrOnboardingChecklistPage (a manually-ticked punch list), nothing here
 * is editable: a form only shows complete once it's actually been signed.
 *
 * Dispatched from m.$module.$submodule.tsx for custom ===
 * "technician-form-checklist"; the route already renders <AppHeader />
 * and gates access to ADMIN / HR (DASHBOARD_ROLE_GATES).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ClipboardCheck, Loader2, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { TECHNICIAN_PAY_ROLES, normalizeRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { getAllSignableDocuments, type SignableDocument, type SignableDocumentType } from "@/lib/supabase/signableDocuments";
import { SIGNABLE_DOCUMENT_REGISTRY } from "@/lib/signableDocumentRegistry";

// Same set of forms as ReportHRDaily.tsx's automatedFormsTechnicianTabs,
// minus contractorDataUs/vehicleUseAgreement (those moved to the BM/SBS/
// Tech Director tier, not rank-and-file technicians).
const TECH_FORM_TYPES: SignableDocumentType[] = [
  "wage_ack",
  "car_iq_agreement",
  "vehicle_agreement",
  "damage",
  "direct_deposit",
  "employee_confidentiality",
  "contractor_data",
  "flash_technician_travel",
  "location_consent",
  "meal_rest_break",
  "mileage_fuel",
  "parts_responsibility",
  "pto_ack",
  "substance_screening",
];

interface TechRow {
  profileId: string;
  name: string;
  roleLabel: string;
  branch: string;
  docs: Map<SignableDocumentType, SignableDocument | undefined>;
  doneCount: number;
}

function isComplete(doc: SignableDocument | undefined): boolean {
  return doc?.status === "signed" || doc?.status === "confirmed";
}

type SortMode = "missing-desc" | "missing-asc" | "name" | "branch";

export function TechnicianFormChecklistPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TechRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hideComplete, setHideComplete] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("missing-desc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [users, docs] = await Promise.all([getCompanyUsers(), getAllSignableDocuments()]);
      const technicians = (users as ProfileRow[]).filter(
        (u) => u.is_active && TECHNICIAN_PAY_ROLES.has(normalizeRole(u.role))
      );

      // getAllSignableDocuments returns newest-first, so the first match
      // per (recipientId, documentType) is the current/latest one — a
      // resent form correctly replaces an older stale entry instead of
      // both counting.
      const latestByRecipientAndType = new Map<string, SignableDocument>();
      for (const d of docs) {
        if (!d.recipientId) continue;
        const key = `${d.recipientId}|${d.documentType}`;
        if (!latestByRecipientAndType.has(key)) latestByRecipientAndType.set(key, d);
      }

      const next: TechRow[] = technicians.map((u) => {
        const docMap = new Map<SignableDocumentType, SignableDocument | undefined>();
        let doneCount = 0;
        for (const type of TECH_FORM_TYPES) {
          const doc = latestByRecipientAndType.get(`${u.id}|${type}`);
          docMap.set(type, doc);
          if (isComplete(doc)) doneCount++;
        }
        return {
          profileId: u.id,
          name: u.display_name || u.username || u.email || "Unnamed",
          roleLabel: getRoleDepartmentBreakdown(u.role || "").roleLabel,
          branch: u.assigned_branch || "—",
          docs: docMap,
          doneCount,
        };
      });
      setRows(next);
      setExpanded((cur) => (cur && next.some((r) => r.profileId === cur) ? cur : next[0]?.profileId ?? null));
    } catch (err) {
      console.error("Technician form checklist load failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const branchOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.branch))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const visibleRows = useMemo(() => {
    let result = rows;
    if (hideComplete) result = result.filter((r) => r.doneCount < TECH_FORM_TYPES.length);
    if (branchFilter) result = result.filter((r) => r.branch === branchFilter);
    const missing = (r: TechRow) => TECH_FORM_TYPES.length - r.doneCount;
    result = [...result].sort((a, b) => {
      switch (sortMode) {
        case "missing-asc":
          return missing(a) - missing(b) || a.name.localeCompare(b.name);
        case "name":
          return a.name.localeCompare(b.name);
        case "branch":
          return a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name);
        case "missing-desc":
        default:
          return missing(b) - missing(a) || a.name.localeCompare(b.name);
      }
    });
    return result;
  }, [rows, hideComplete, branchFilter, sortMode]);

  return (
    <main className="max-w-[1000px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => navigate({ to: "/m/$module", params: { module: "hr" } })}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <ClipboardCheck className="h-5 w-5" /> Technician Form Checklist
          </h1>
          <p className="text-sm text-slate-400">Live signed/pending status for every Technician-tab form — nothing here is manually checked.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Branch</label>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-lg border border-white/15 bg-slate-900/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All branches</option>
            {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Sort</label>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-lg border border-white/15 bg-slate-900/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="missing-desc">Most missing first</option>
            <option value="missing-asc">Fewest missing first</option>
            <option value="name">Name (A–Z)</option>
            <option value="branch">Branch (A–Z)</option>
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0 mt-4">
          <input type="checkbox" checked={hideComplete} onChange={(e) => setHideComplete(e.target.checked)} className="h-3.5 w-3.5" />
          Hide complete
        </label>
        {(branchFilter || sortMode !== "missing-desc" || hideComplete) && (
          <button
            type="button"
            onClick={() => { setBranchFilter(""); setSortMode("missing-desc"); setHideComplete(false); }}
            className="text-xs text-blue-400 hover:text-blue-300 mt-4"
          >
            Reset filters
          </button>
        )}
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 px-6 py-16 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm text-slate-400">{rows.length === 0 ? "No active technicians found." : "Every technician is fully signed up."}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleRows.map((r) => {
            const isOpen = expanded === r.profileId;
            const total = TECH_FORM_TYPES.length;
            return (
              <div key={r.profileId} className="rounded-xl border border-white/10 bg-slate-900/40">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : r.profileId)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{r.name}</p>
                    <p className="text-[11px] text-slate-400">{r.roleLabel} · {r.branch}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold ${r.doneCount === total ? "text-emerald-400" : "text-slate-300"}`}>
                    {r.doneCount}/{total}
                  </span>
                  <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-white/10 sm:block">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${total ? (r.doneCount / total) * 100 : 0}%` }}
                    />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-white/10 px-4 py-3">
                    <ul className="space-y-2">
                      {TECH_FORM_TYPES.map((type) => {
                        const doc = r.docs.get(type);
                        const done = isComplete(doc);
                        const pending = doc?.status === "pending_signature";
                        const label = SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type;
                        return (
                          <li key={type} className="flex items-center gap-2.5 text-sm">
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                done ? "border-emerald-500 bg-emerald-500 text-slate-950" : pending ? "border-amber-500/60 bg-transparent" : "border-white/20 bg-transparent"
                              }`}
                            >
                              {done && <span className="text-[10px] font-bold leading-none">✓</span>}
                            </span>
                            <span className={`flex-1 min-w-0 ${done ? "text-slate-400" : "text-slate-200"}`}>{label}</span>
                            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${
                              done ? "text-emerald-400" : pending ? "text-amber-400" : "text-slate-600"
                            }`}>
                              {done ? "Signed" : pending ? "Pending" : "Not sent"}
                            </span>
                            {doc?.pdfUrl && (
                              <a
                                href={doc.pdfUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex shrink-0 items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300"
                              >
                                view <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
