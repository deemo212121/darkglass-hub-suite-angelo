/**
 * HR module -> Staff Form Checklist. Per-person live status of every
 * signable form for 5 tiers, each its own tab — pulled straight from
 * hr_signable_documents via getAllSignableDocuments, not a separately-
 * tracked checklist. Unlike HrOnboardingChecklistPage (a manually-ticked
 * punch list), nothing here is editable: a form only shows complete once
 * it's actually been signed.
 *
 * Tabs (see CHECKLIST_TABS below):
 *  - Technician — the original 16-form checklist, unchanged.
 *  - New Technician — same technician population, the new consolidated
 *    forms (Master W-2 Technician Agreement, W-4, I-9, Direct Deposit).
 *  - Office Staff (US) — everyone else in the US who isn't a field
 *    technician or Branch Manager tier and up.
 *  - PH Staff — anyone assigned to a Philippines branch, any role.
 *  - BM, SBS, Tech Director, Tech Assistant Director — that specific
 *    management tier's own new forms (Contractor Addendum, W-9, Direct
 *    Deposit). Deliberately excluded from Office Staff (US) even though
 *    they're US-based, since they need this tier's forms tracked instead.
 *
 * One fetch (users/docs/exemptions) serves all 5 tabs — each tab's row list
 * is just a different filter+form-type-set derived from the same raw data,
 * recomputed via useMemo when the active tab or the raw data changes.
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
import { isEligibleForTechnicianFormChecklist, isBmAndUpRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { getSignableDocumentsByTypes, createSignableDocument, type SignableDocument, type SignableDocumentType } from "@/lib/supabase/signableDocuments";
import { SIGNABLE_DOCUMENT_REGISTRY, TECHNICIAN_FORM_TYPES, getDocumentReviewStatus, isTechnicianExemptFromForm, exemptionRowValueForToggle, pickAuthoritativeDocument } from "@/lib/signableDocumentRegistry";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { getTechnicianFormExemptions, setTechnicianFormExemption } from "@/lib/supabase/technicianFormExemptions";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getAppUrl } from "@/lib/appUrl";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";

// Same derivation ReportHRDaily.tsx's onboarding/attendance splits use for
// "PH" vs "US" — there's no real country column, just branch membership in
// the Philippines subset of LOCATIONS_DATA.
const PH_BRANCH_NAMES = new Set(LOCATIONS_DATA.filter((l) => l.isPhilippines).map((l) => l.location));
const isPhBranch = (u: ProfileRow) => PH_BRANCH_NAMES.has(u.assigned_branch || "");

const NEW_TECHNICIAN_FORM_TYPES: SignableDocumentType[] = ["master_w2_agreement", "w4", "i9", "direct_deposit"];
const OFFICE_STAFF_US_FORM_TYPES: SignableDocumentType[] = ["master_w2_office_agreement", "w4", "i9", "direct_deposit"];
const PH_STAFF_FORM_TYPES: SignableDocumentType[] = ["master_ph_contractor_agreement", "w8ben", "direct_deposit"];
const BM_AND_UP_FORM_TYPES: SignableDocumentType[] = ["contractor_addendum", "w9", "direct_deposit"];

type ChecklistTabKey = "technician" | "newTechnician" | "officeStaffUs" | "phStaff" | "bmAndUp";

interface ChecklistTabConfig {
  key: ChecklistTabKey;
  label: string;
  formTypes: SignableDocumentType[];
  isEligible: (u: ProfileRow) => boolean;
  /** Plural noun used in "N technicians" / "No office staff found." messaging. */
  noun: string;
}

const CHECKLIST_TABS: ChecklistTabConfig[] = [
  {
    key: "technician",
    label: "Technician",
    formTypes: TECHNICIAN_FORM_TYPES,
    isEligible: (u) => isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "technicians",
  },
  {
    key: "newTechnician",
    label: "New Technician",
    formTypes: NEW_TECHNICIAN_FORM_TYPES,
    isEligible: (u) => isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "technicians",
  },
  {
    key: "officeStaffUs",
    label: "Office Staff (US)",
    formTypes: OFFICE_STAFF_US_FORM_TYPES,
    isEligible: (u) => !isPhBranch(u) && !isBmAndUpRole(u.role) && !isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "office staff",
  },
  {
    key: "phStaff",
    label: "PH Staff",
    formTypes: PH_STAFF_FORM_TYPES,
    isEligible: (u) => isPhBranch(u),
    noun: "PH staff",
  },
  {
    key: "bmAndUp",
    label: "BM, SBS, Tech Director, Tech Assistant Director",
    formTypes: BM_AND_UP_FORM_TYPES,
    isEligible: (u) => isBmAndUpRole(u.role),
    noun: "management staff",
  },
];

interface TechRow {
  profileId: string;
  name: string;
  roleLabel: string;
  branch: string;
  docs: Map<SignableDocumentType, SignableDocument | undefined>;
  /** Forms marked Not Applicable for this person — excluded from both doneCount and applicableTotal. */
  exempt: Set<SignableDocumentType>;
  doneCount: number;
  applicableTotal: number;
  /** Frozen accounts can still log in but are restricted to Messages only (see migration 0223) — clock in/out and ticket writes are also blocked server-side. */
  frozen: boolean;
}

function isComplete(doc: SignableDocument | undefined, type: SignableDocumentType): boolean {
  return getDocumentReviewStatus(type, doc) === "done";
}

type SortMode = "missing-desc" | "missing-asc" | "name" | "branch";

export function TechnicianFormChecklistPage() {
  const navigate = useNavigate();
  const { uid, displayName } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [activeChecklistTab, setActiveChecklistTab] = useState<ChecklistTabKey>("technician");
  const [allUsers, setAllUsers] = useState<ProfileRow[]>([]);
  const [latestByKey, setLatestByKey] = useState<Map<string, SignableDocument>>(new Map());
  const [exemptions, setExemptions] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hideComplete, setHideComplete] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("missing-desc");
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeConfig = useMemo(() => CHECKLIST_TABS.find((t) => t.key === activeChecklistTab) ?? CHECKLIST_TABS[0], [activeChecklistTab]);

  useEffect(() => {
    if (!uid) return;
    getMyProfileId(uid).then(setMyProfileId).catch(() => setMyProfileId(null));
  }, [uid]);

  // The roster doesn't vary per tab — fetched once (and on manual Refresh),
  // not re-pulled every time the active tab changes.
  const [usersLoading, setUsersLoading] = useState(true);
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const users = await getCompanyUsers();
      setAllUsers((users as ProfileRow[]).filter((u) => u.is_active));
    } catch (err) {
      console.error("Staff form checklist: failed to load users:", err);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Scoped to the currently active tab's own form-type set (not every
  // document type in the company) — re-runs whenever the tab changes, so
  // switching tabs costs one small, targeted fetch instead of the page
  // eagerly pulling the whole company's signable-document history up front.
  const [docsLoading, setDocsLoading] = useState(true);
  const loadDocsForActiveTab = useCallback(async () => {
    setDocsLoading(true);
    try {
      const [docs, exemptionRows] = await Promise.all([
        getSignableDocumentsByTypes(activeConfig.formTypes),
        getTechnicianFormExemptions(activeConfig.formTypes),
      ]);

      // Group every row per (person, documentType) — NOT just "keep the
      // newest" (that let a re-sent, still-pending duplicate hide an
      // earlier row the person had genuinely already signed/confirmed,
      // making a completed form show as "Not sent" again). pickAuthoritativeDocument
      // picks whichever row actually represents the best status reached.
      //
      // "person" here is formData.employeeId, NOT d.recipientId —
      // recipientId is who currently needs to ACT on the document, and gets
      // reassigned to whichever HR staffer completes the employer/
      // countersign step. A fully confirmed two-party form's recipientId
      // permanently points at that HR staffer, not the person, so grouping
      // by recipientId made every one of these vanish from the checklist
      // back to "Not sent" the moment it was actually finished.
      // formData.employeeId is set once at creation and never changes, so
      // it's the stable "whose form is this" identity.
      const byKey = new Map<string, SignableDocument[]>();
      for (const d of docs) {
        const personId = (d.formData as Record<string, any> | undefined)?.employeeId || d.recipientId;
        if (!personId) continue;
        const key = `${personId}|${d.documentType}`;
        const arr = byKey.get(key);
        if (arr) arr.push(d);
        else byKey.set(key, [d]);
      }
      const latest = new Map<string, SignableDocument>();
      for (const [key, group] of byKey) {
        const best = pickAuthoritativeDocument(group);
        if (best) latest.set(key, best);
      }

      setLatestByKey(latest);
      setExemptions(exemptionRows);
    } catch (err) {
      console.error("Staff form checklist: failed to load documents:", err);
    } finally {
      setDocsLoading(false);
    }
  }, [activeConfig]);

  const loading = usersLoading || docsLoading;

  // Full reload — used by the "Refresh" button and by every action handler
  // below that needs the freshest state after a write (a new roster member,
  // a just-sent/just-signed form, a freeze toggle, etc.).
  const load = useCallback(async () => {
    await Promise.all([loadUsers(), loadDocsForActiveTab()]);
  }, [loadUsers, loadDocsForActiveTab]);

  useEffect(() => {
    void loadUsers();
    // Runs once on mount only — the roster doesn't depend on the active tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetches whenever `loadDocsForActiveTab` itself changes — which
  // happens whenever activeConfig does, so switching tabs automatically
  // (re)loads just that tab's own form types, without touching the roster.
  useEffect(() => {
    void loadDocsForActiveTab();
  }, [loadDocsForActiveTab]);

  const rows: TechRow[] = useMemo(() => {
    return allUsers.filter(activeConfig.isEligible).map((u) => {
      const docMap = new Map<SignableDocumentType, SignableDocument | undefined>();
      const exempt = new Set<SignableDocumentType>();
      let doneCount = 0;
      for (const type of activeConfig.formTypes) {
        const doc = latestByKey.get(`${u.id}|${type}`);
        docMap.set(type, doc);
        if (isTechnicianExemptFromForm(type, !!doc, exemptions.has(`${u.id}|${type}`))) {
          exempt.add(type);
        } else if (isComplete(doc, type)) {
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
        applicableTotal: activeConfig.formTypes.length - exempt.size,
        frozen: u.frozen === true,
      };
    });
  }, [allUsers, latestByKey, exemptions, activeConfig]);

  // Auto-(re)select a row to expand whenever the underlying row list changes
  // (data refresh OR switching tabs) — keeps the current selection if it's
  // still present in the new list, otherwise falls back to the first row.
  useEffect(() => {
    setExpanded((cur) => (cur && rows.some((r) => r.profileId === cur) ? cur : rows[0]?.profileId ?? null));
  }, [rows]);

  const handleTabChange = (key: ChecklistTabKey) => {
    setActiveChecklistTab(key);
    setSearch("");
    setBranchFilter("");
    setSortMode("missing-desc");
    setHideComplete(false);
  };

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
  const handleSendForm = async (personId: string, personName: string, type: SignableDocumentType) => {
    const key = `${personId}|${type}`;
    setActionKey(key);
    setActionError(null);
    try {
      const doc = await createSignableDocument({
        documentType: type,
        formData: { employeeId: personId, employeeName: personName },
        recipientId: personId,
        recipientSlot: "employee",
        pdfUrl: "",
      });
      if (myProfileId) {
        const thread = await getOrCreateDmThread(myProfileId, personId);
        const fillLink = `${getAppUrl()}${SIGNABLE_DOCUMENT_REGISTRY[type].internalPath}/${doc.id}`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "HR",
          body: `📋 Please complete the ${SIGNABLE_DOCUMENT_REGISTRY[type].label}: ${fillLink}`,
        });
      }
      void logActivity({ action: `${type}_sent`, targetType: "employee", targetId: personId, targetLabel: personName });
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
  const handleRemindForm = async (doc: SignableDocument, personId: string, type: SignableDocumentType) => {
    const key = `${personId}|${type}`;
    setActionKey(key);
    setActionError(null);
    try {
      if (myProfileId) {
        const thread = await getOrCreateDmThread(myProfileId, personId);
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

  // "Not Applicable" — this person doesn't need this form. `exemptions`
  // tracks raw row-existence ("${personId}|${type}" has an exemption row at
  // all), not the UI-level exempt/not-exempt meaning — that's derived per
  // row in the `rows` memo above via isTechnicianExemptFromForm, same as
  // isComplete. exemptionRowValueForToggle inverts for DEFAULT_EXEMPT_
  // DOCUMENT_TYPES (a type that's N/A by default, like Flash Technician
  // Travel), so "checked" doesn't always mean "create a row" — it means
  // whatever value makes isTechnicianExemptFromForm agree with the checkbox
  // the person just clicked.
  const handleToggleExempt = async (personId: string, type: SignableDocumentType, checked: boolean) => {
    const key = `${personId}|${type}`;
    const willHaveRow = exemptionRowValueForToggle(type, checked);
    setActionKey(key);
    setActionError(null);
    setExemptions((prev) => {
      const next = new Set(prev);
      if (willHaveRow) next.add(key);
      else next.delete(key);
      return next;
    });
    try {
      await setTechnicianFormExemption(personId, type, willHaveRow, displayName || "HR");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update.");
      await load();
    } finally {
      setActionKey(null);
    }
  };

  // Freeze/unfreeze — a frozen person can still log in but is restricted to
  // Messages only (so they can still complete pending forms there), and is
  // also blocked server-side from clock in/out and ticket writes (migration
  // 0223's triggers). Optimistic local update since the whole point is to
  // see the row flip immediately.
  const handleToggleFreeze = async (personId: string, personName: string, currentlyFrozen: boolean) => {
    if (!myProfileId) return;
    const verb = currentlyFrozen ? "unfreeze" : "freeze";
    const warning = currentlyFrozen
      ? `Unfreeze ${personName}? They'll regain full access to the app.`
      : `Freeze ${personName}'s account? They'll still be able to log in, but will only be able to open Messages — clock in/out and ticket access will be blocked until unfrozen.`;
    if (!window.confirm(warning)) return;
    const key = `${personId}|freeze`;
    setActionKey(key);
    setActionError(null);
    setAllUsers((prev) => prev.map((u) => (u.id === personId ? { ...u, frozen: !currentlyFrozen } : u)));
    try {
      await setProfileFrozen(personId, !currentlyFrozen, myProfileId, displayName || "HR");
      void logActivity({
        action: currentlyFrozen ? "technician_unfrozen" : "technician_frozen",
        targetType: "employee",
        targetId: personId,
        targetLabel: personName,
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
            <ClipboardCheck className="h-5 w-5" /> Staff Form Checklist
          </h1>
          <p className="text-sm text-slate-400">Live signed/pending status for every tracked form, per tier — nothing here is manually checked.</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300">
          {visibleRows.length === rows.length
            ? `${rows.length} ${activeConfig.noun}`
            : `${visibleRows.length} of ${rows.length} ${activeConfig.noun}`}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5 border-b border-white/10 pb-3">
        {CHECKLIST_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleTabChange(tab.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
              activeChecklistTab === tab.key
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"
            }`}
          >
            {tab.label}
          </button>
        ))}
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
              placeholder="Name…"
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
            {rows.length === 0 ? `No ${activeConfig.noun} found.` : search.trim() ? `No ${activeConfig.noun.slice(0, -1)} matches "${search.trim()}".` : `Every one of these ${activeConfig.noun} is fully signed up.`}
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
                      {activeConfig.formTypes.map((type) => {
                        const doc = r.docs.get(type);
                        const na = r.exempt.has(type);
                        const reviewStatus = na ? null : getDocumentReviewStatus(type, doc);
                        const done = reviewStatus === "done";
                        const awaitingEmployee = reviewStatus === "awaiting_employee";
                        const awaitingHr = reviewStatus === "awaiting_hr";
                        const label = SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type;
                        const key = `${r.profileId}|${type}`;
                        const busy = actionKey === key;
                        const statusText = na
                          ? "N/A"
                          : done
                          ? "Signed"
                          : awaitingHr
                          ? "Awaiting HR review"
                          : awaitingEmployee
                          ? "Awaiting employee signature"
                          : "Not sent";
                        const statusColor = na
                          ? "text-slate-500"
                          : done
                          ? "text-emerald-400"
                          : awaitingHr
                          ? "text-sky-400"
                          : awaitingEmployee
                          ? "text-amber-400"
                          : "text-slate-600";
                        const markerClass = done
                          ? "border-emerald-500 bg-emerald-500 text-slate-950"
                          : awaitingHr
                          ? "border-sky-500/60 bg-sky-500/20"
                          : awaitingEmployee
                          ? "border-amber-500/60 bg-transparent"
                          : "border-white/20 bg-transparent";
                        return (
                          <li key={type} className={`flex items-center gap-2.5 text-sm ${na ? "opacity-50" : ""}`}>
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${markerClass}`}>
                              {done && <span className="text-[10px] font-bold leading-none">✓</span>}
                            </span>
                            <span className={`flex-1 min-w-0 ${done ? "text-slate-400" : "text-slate-200"}`}>{label}</span>
                            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${statusColor}`}>
                              {statusText}
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
                            {!na && awaitingEmployee && (
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
                            {!na && awaitingHr && (
                              <span title="This person has signed — this form now needs HR's own review/countersignature in Attendance Monitoring." className="shrink-0 text-[10px] text-sky-400/80">
                                Needs your review
                              </span>
                            )}
                            {!na && reviewStatus === "not_sent" && (
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
                              title="This person doesn't need this form"
                              className="inline-flex shrink-0 items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={na}
                                disabled={busy || done || awaitingHr}
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
