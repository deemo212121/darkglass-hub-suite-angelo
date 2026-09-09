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
import { ChevronLeft, ClipboardCheck, Loader2, ChevronDown, ExternalLink, RefreshCw, Send, Bell, Snowflake, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileId, setProfileFrozen, type ProfileRow } from "@/lib/supabase/users";
import { TECHNICIAN_PAY_ROLES, normalizeRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { getAllSignableDocuments, createSignableDocument, type SignableDocument, type SignableDocumentType } from "@/lib/supabase/signableDocuments";
import { SIGNABLE_DOCUMENT_REGISTRY, TECHNICIAN_FORM_TYPES } from "@/lib/signableDocumentRegistry";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { getTechnicianFormExemptions, setTechnicianFormExemption } from "@/lib/supabase/technicianFormExemptions";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getAppUrl } from "@/lib/appUrl";

// TECH_FORM_TYPES now lives in signableDocumentRegistry.ts as
// TECHNICIAN_FORM_TYPES, shared with the frozen-account "forms you still
// need to sign" popup — kept as a local alias so nothing else in this file
// needs to change.
const TECH_FORM_TYPES = TECHNICIAN_FORM_TYPES;

interface TechRow {
  profileId: string;
  name: string;
  roleLabel: string;
  branch: string;
  docs: Map<SignableDocumentType, SignableDocument | undefined>;
  /** Forms marked Not Applicable for this technician — excluded from both doneCount and applicableTotal. */
  exempt: Set<SignableDocumentType>;
  doneCount: number;
  applicableTotal: number;
  /** Frozen accounts can still log in but are restricted to Messages only (see migration 0223) — clock in/out and ticket writes are also blocked server-side. */
  frozen: boolean;
}

function isComplete(doc: SignableDocument | undefined): boolean {
  return doc?.status === "signed" || doc?.status === "confirmed";
}

type SortMode = "missing-desc" | "missing-asc" | "name" | "branch";

export function TechnicianFormChecklistPage() {
  const navigate = useNavigate();
  const { uid, displayName } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [rows, setRows] = useState<TechRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hideComplete, setHideComplete] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("missing-desc");
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    getMyProfileId(uid).then(setMyProfileId).catch(() => setMyProfileId(null));
  }, [uid]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [users, docs, exemptions] = await Promise.all([getCompanyUsers(), getAllSignableDocuments(), getTechnicianFormExemptions()]);
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
        const exempt = new Set<SignableDocumentType>();
        let doneCount = 0;
        for (const type of TECH_FORM_TYPES) {
          const doc = latestByRecipientAndType.get(`${u.id}|${type}`);
          docMap.set(type, doc);
          if (exemptions.has(`${u.id}|${type}`)) {
            exempt.add(type);
          } else if (isComplete(doc)) {
            doneCount++;
          }
        }
        return {
          profileId: u.id,
          name: u.display_name || u.username || u.email || "Unnamed",
          roleLabel: getRoleDepartmentBreakdown(u.role || "").roleLabel,
          branch: u.assigned_branch || "—",
          docs: docMap,
          exempt,
          doneCount,
          applicableTotal: TECH_FORM_TYPES.length - exempt.size,
          frozen: u.frozen === true,
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
    if (hideComplete) result = result.filter((r) => r.doneCount < r.applicableTotal);
    if (branchFilter) result = result.filter((r) => r.branch === branchFilter);
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((r) => r.name.toLowerCase().includes(q));
    const missing = (r: TechRow) => r.applicableTotal - r.doneCount;
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
  }, [rows, hideComplete, branchFilter, sortMode, search]);

  // "Not sent" — creates the document (same formData/recipientSlot shape
  // every individual Send handler in ReportHRDaily.tsx uses: just the
  // recipient's id/name, the recipient fills in everything else
  // themselves) and DMs them the fill link.
  const handleSendForm = async (technicianId: string, technicianName: string, type: SignableDocumentType) => {
    const key = `${technicianId}|${type}`;
    setActionKey(key);
    setActionError(null);
    try {
      const doc = await createSignableDocument({
        documentType: type,
        formData: { employeeId: technicianId, employeeName: technicianName },
        recipientId: technicianId,
        recipientSlot: "employee",
        pdfUrl: "",
      });
      if (myProfileId) {
        const thread = await getOrCreateDmThread(myProfileId, technicianId);
        const fillLink = `${getAppUrl()}${SIGNABLE_DOCUMENT_REGISTRY[type].internalPath}/${doc.id}`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "HR",
          body: `📋 Please complete the ${SIGNABLE_DOCUMENT_REGISTRY[type].label}: ${fillLink}`,
        });
      }
      void logActivity({ action: `${type}_sent`, targetType: "employee", targetId: technicianId, targetLabel: technicianName });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send form.");
    } finally {
      setActionKey(null);
    }
  };

  // "Pending" — the document already exists (they just haven't signed it
  // yet); nudge with a DM to the SAME fill link rather than creating a
  // duplicate document.
  const handleRemindForm = async (doc: SignableDocument, technicianId: string, type: SignableDocumentType) => {
    const key = `${technicianId}|${type}`;
    setActionKey(key);
    setActionError(null);
    try {
      if (myProfileId) {
        const thread = await getOrCreateDmThread(myProfileId, technicianId);
        const fillLink = `${getAppUrl()}${SIGNABLE_DOCUMENT_REGISTRY[type].internalPath}/${doc.id}`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "HR",
          body: `⏰ Reminder — please complete the ${SIGNABLE_DOCUMENT_REGISTRY[type].label}: ${fillLink}`,
        });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send reminder.");
    } finally {
      setActionKey(null);
    }
  };

  // "Not Applicable" — this technician doesn't need this form; excluded
  // from doneCount/applicableTotal (see load()) rather than counted as
  // either done or missing. Optimistic local update, then a background
  // reload to pick up applicableTotal recomputed for real.
  const handleToggleExempt = async (technicianId: string, type: SignableDocumentType, checked: boolean) => {
    const key = `${technicianId}|${type}`;
    setActionKey(key);
    setActionError(null);
    setRows((prev) =>
      prev.map((r) => {
        if (r.profileId !== technicianId) return r;
        const exempt = new Set(r.exempt);
        const wasComplete = isComplete(r.docs.get(type));
        if (checked) exempt.add(type);
        else exempt.delete(type);
        const doneCount = r.doneCount + (checked ? (wasComplete ? -1 : 0) : (wasComplete ? 1 : 0));
        return { ...r, exempt, doneCount, applicableTotal: TECH_FORM_TYPES.length - exempt.size };
      })
    );
    try {
      await setTechnicianFormExemption(technicianId, type, checked, displayName || "HR");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update.");
      await load();
    } finally {
      setActionKey(null);
    }
  };

  // Freeze/unfreeze — a frozen technician can still log in but is
  // restricted to Messages only (so they can still complete pending forms
  // there), and is also blocked server-side from clock in/out and ticket
  // writes (migration 0223's triggers). Optimistic local update since the
  // whole point is to see the row flip immediately.
  const handleToggleFreeze = async (technicianId: string, technicianName: string, currentlyFrozen: boolean) => {
    if (!myProfileId) return;
    const verb = currentlyFrozen ? "unfreeze" : "freeze";
    const warning = currentlyFrozen
      ? `Unfreeze ${technicianName}? They'll regain full access to the app.`
      : `Freeze ${technicianName}'s account? They'll still be able to log in, but will only be able to open Messages — clock in/out and ticket access will be blocked until unfrozen.`;
    if (!window.confirm(warning)) return;
    const key = `${technicianId}|freeze`;
    setActionKey(key);
    setActionError(null);
    setRows((prev) => prev.map((r) => (r.profileId === technicianId ? { ...r, frozen: !currentlyFrozen } : r)));
    try {
      await setProfileFrozen(technicianId, !currentlyFrozen, myProfileId, displayName || "HR");
      void logActivity({
        action: currentlyFrozen ? "technician_unfrozen" : "technician_frozen",
        targetType: "employee",
        targetId: technicianId,
        targetLabel: technicianName,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${verb} account.`);
      await load();
    } finally {
      setActionKey(null);
    }
  };

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
        <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300">
          {visibleRows.length === rows.length
            ? `${rows.length} technician${rows.length === 1 ? "" : "s"}`
            : `${visibleRows.length} of ${rows.length} technicians`}
        </span>
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
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Technician name…"
              className="w-44 rounded-lg border border-white/15 bg-slate-900/60 py-1.5 pl-8 pr-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
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
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Complete</label>
          <select
            value={hideComplete ? "hide" : "show"}
            onChange={(e) => setHideComplete(e.target.value === "hide")}
            className="rounded-lg border border-white/15 bg-slate-900/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="show">Show complete</option>
            <option value="hide">Hide complete</option>
          </select>
        </div>
        {(search || branchFilter || sortMode !== "missing-desc" || hideComplete) && (
          <button
            type="button"
            onClick={() => { setSearch(""); setBranchFilter(""); setSortMode("missing-desc"); setHideComplete(false); }}
            className="text-xs text-blue-400 hover:text-blue-300 mt-4"
          >
            Reset filters
          </button>
        )}
      </div>

      {actionError && (
        <p className="mb-4 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{actionError}</p>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 px-6 py-16 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm text-slate-400">
            {rows.length === 0 ? "No active technicians found." : search.trim() ? `No technician matches "${search.trim()}".` : "Every technician is fully signed up."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleRows.map((r) => {
            const isOpen = expanded === r.profileId;
            const total = r.applicableTotal;
            return (
              <div key={r.profileId} className={`rounded-xl border bg-slate-900/40 ${r.frozen ? "border-sky-500/40" : "border-white/10"}`}>
                <div className="flex w-full items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.profileId)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white flex items-center gap-1.5">
                        {r.name}
                        {r.frozen && <span className="shrink-0 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">Frozen</span>}
                      </p>
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
                  <button
                    type="button"
                    disabled={actionKey === `${r.profileId}|freeze`}
                    onClick={() => void handleToggleFreeze(r.profileId, r.name, r.frozen)}
                    title={r.frozen ? "Unfreeze account" : "Freeze account (restrict to Messages only)"}
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-50 ${
                      r.frozen
                        ? "border-sky-500/50 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                        : "border-white/15 bg-white/5 text-slate-400 hover:text-sky-300 hover:border-sky-500/40"
                    }`}
                  >
                    {actionKey === `${r.profileId}|freeze` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Snowflake className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-white/10 px-4 py-3">
                    <ul className="space-y-2">
                      {TECH_FORM_TYPES.map((type) => {
                        const doc = r.docs.get(type);
                        const na = r.exempt.has(type);
                        const done = !na && isComplete(doc);
                        const pending = !na && doc?.status === "pending_signature";
                        const label = SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type;
                        const key = `${r.profileId}|${type}`;
                        const busy = actionKey === key;
                        return (
                          <li key={type} className={`flex items-center gap-2.5 text-sm ${na ? "opacity-50" : ""}`}>
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                done ? "border-emerald-500 bg-emerald-500 text-slate-950" : pending ? "border-amber-500/60 bg-transparent" : "border-white/20 bg-transparent"
                              }`}
                            >
                              {done && <span className="text-[10px] font-bold leading-none">✓</span>}
                            </span>
                            <span className={`flex-1 min-w-0 ${done ? "text-slate-400" : "text-slate-200"}`}>{label}</span>
                            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${
                              na ? "text-slate-500" : done ? "text-emerald-400" : pending ? "text-amber-400" : "text-slate-600"
                            }`}>
                              {na ? "N/A" : done ? "Signed" : pending ? "Pending" : "Not sent"}
                            </span>
                            {!na && doc?.pdfUrl && (
                              <a
                                href={doc.pdfUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex shrink-0 items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300"
                              >
                                view <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {!na && !done && pending && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => doc && void handleRemindForm(doc, r.profileId, type)}
                                title="Send a reminder DM with the fill link"
                                className="inline-flex shrink-0 items-center gap-1 text-xs text-amber-300 hover:text-amber-200 disabled:opacity-40"
                              >
                                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />} Remind
                              </button>
                            )}
                            {!na && !done && !pending && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleSendForm(r.profileId, r.name, type)}
                                title="Create and send this form"
                                className="inline-flex shrink-0 items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40"
                              >
                                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send
                              </button>
                            )}
                            <label
                              title="This technician doesn't need this form"
                              className="inline-flex shrink-0 items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={na}
                                disabled={busy || done}
                                onChange={(e) => void handleToggleExempt(r.profileId, type, e.target.checked)}
                                className="h-3 w-3"
                              />
                              N/A
                            </label>
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
