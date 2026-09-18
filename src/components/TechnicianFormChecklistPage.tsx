/**
 * HR module -> Staff Form Checklist. Per-person live status of every
 * signable form for 5 tiers, each its own tab — pulled straight from
 * hr_signable_documents via getSignableDocumentsByTypes, scoped to
 * whichever tab is active, not a separately-tracked checklist. Unlike
 * HrOnboardingChecklistPage (a manually-ticked punch list), nothing here is
 * editable: a form only shows complete once it's actually been signed.
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
 * W-4/I-9/Direct Deposit/W-8BEN are shared document types between an old
 * tab and one or more new ones — each tab only counts submissions from its
 * own formSourceBucket (see SHARED_OLD_NEW_AUTOMATION_TYPES/
 * isNewAutomationDoc in signableDocumentRegistry.ts), so e.g. New
 * Technician's W-4 row never shows "done" off an old-flow submission it
 * never actually sent, and vice versa.
 *
 * The roster (loadUsers) is fetched once; documents+exemptions
 * (loadDocsForActiveTab) are re-fetched, scoped to just that tab's own form
 * types, whenever the active tab changes — see load()'s own comments.
 *
 * Dispatched from m.$module.$submodule.tsx for custom ===
 * "technician-form-checklist"; the route already renders <AppHeader />
 * and gates access to ADMIN / HR (DASHBOARD_ROLE_GATES).
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ClipboardCheck, Loader2, ChevronDown, ExternalLink, RefreshCw, Send, Bell, Snowflake, Search, X, PenLine, Filter } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ManagerReviewPage, SUPPORTED_TYPES as EMPLOYER_SIGN_SUPPORTED_TYPES } from "@/components/ManagerReviewPage";
import { getCompanyUsers, getMyProfileId, setProfileFrozen, type ProfileRow } from "@/lib/supabase/users";
import { isEligibleForTechnicianFormChecklist, isBmAndUpRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { getSignableDocumentsByTypes, getExistingActiveDocumentTypes, createSignableDocument, updateSignableDocumentPdfUrl, updateSignableDocumentFormData, confirmSignableDocument, type SignableDocument, type SignableDocumentType } from "@/lib/supabase/signableDocuments";
import {
  SIGNABLE_DOCUMENT_REGISTRY,
  TECHNICIAN_FORM_TYPES,
  NEW_TECHNICIAN_FORM_TYPES,
  OFFICE_STAFF_US_FORM_TYPES,
  PH_STAFF_FORM_TYPES,
  BM_AND_UP_FORM_TYPES,
  getDocumentReviewStatus,
  isTechnicianExemptFromForm,
  exemptionRowValueForToggle,
  pickAuthoritativeDocument,
  isNewAutomationDoc,
  SHARED_OLD_NEW_AUTOMATION_TYPES,
  type DocumentReviewStatus,
} from "@/lib/signableDocumentRegistry";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { getTechnicianIdDocumentUrl } from "@/lib/supabase/technicianIdDocuments";
import { getTechnicianFormExemptions, setTechnicianFormExemption } from "@/lib/supabase/technicianFormExemptions";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getAppUrl } from "@/lib/appUrl";
import { onTabVisible } from "@/lib/pageVisibility";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";
import { uploadW4Form } from "@/lib/firebase/storage";
import { fillW4Pdf } from "@/lib/w4PdfFill";
import type { W4FormData } from "@/lib/w4FormTemplate";
import { CONTRACTOR_ADDENDUM_POSITION_LEVELS } from "@/lib/contractorAddendumFormTemplate";

// Same derivation ReportHRDaily.tsx's onboarding/attendance splits use for
// "PH" vs "US" — there's no real country column, just branch membership in
// the Philippines subset of LOCATIONS_DATA.
const PH_BRANCH_NAMES = new Set(LOCATIONS_DATA.filter((l) => l.isPhilippines).map((l) => l.location));
const isPhBranch = (u: ProfileRow) => PH_BRANCH_NAMES.has(u.assigned_branch || "");

type ChecklistTabKey = "technician" | "newTechnician" | "officeStaffUs" | "phStaff" | "bmAndUp";

interface ChecklistTabConfig {
  key: ChecklistTabKey;
  label: string;
  formTypes: SignableDocumentType[];
  isEligible: (u: ProfileRow) => boolean;
  /** Plural noun used in "N technicians" / "No office staff found." messaging. */
  noun: string;
  /**
   * Which formSource bucket this tab's SHARED_OLD_NEW_AUTOMATION_TYPES
   * (w4/i9/direct_deposit/w8ben) should count — "old" for the original
   * Technician tab (only pre-New-Automation-Forms submissions), "new" for
   * every other tab (only submissions sent through their own "New
   * Automation Forms" flow). A form type NOT in SHARED_OLD_NEW_AUTOMATION_TYPES
   * (the Master Agreements, Contractor Addendum, W-9) ignores this — there's
   * no old/new split for those yet, so every submission counts regardless.
   */
  formSourceBucket: "old" | "new";
}

/**
 * Identity photos collected alongside a Master Agreement's own typed
 * fields (technicianIdDocuments.ts — private-bucket paths on the
 * document's formData, never a plaintext SSN column). Not part of the
 * signed PDF itself, so they need their own "view" links here rather than
 * riding along with the doc's pdfUrl-driven one above.
 */
const ID_DOC_FIELDS: Partial<Record<SignableDocumentType, { field: string; label: string }[]>> = {
  master_w2_agreement: [
    { field: "licensePhotoPath", label: "License" },
    { field: "ssnCardPhotoPath", label: "SSN Card" },
  ],
  master_w2_office_agreement: [
    { field: "licensePhotoPath", label: "License" },
    { field: "ssnCardPhotoPath", label: "SSN Card" },
  ],
  master_ph_contractor_agreement: [{ field: "governmentIdPhotoPath", label: "ID" }],
};

const CHECKLIST_TABS: ChecklistTabConfig[] = [
  {
    key: "technician",
    label: "Technician",
    formTypes: TECHNICIAN_FORM_TYPES,
    isEligible: (u) => isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "technicians",
    formSourceBucket: "old",
  },
  {
    key: "newTechnician",
    label: "New Technician",
    formTypes: NEW_TECHNICIAN_FORM_TYPES,
    isEligible: (u) => isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "technicians",
    formSourceBucket: "new",
  },
  {
    key: "officeStaffUs",
    label: "Office Staff (US)",
    formTypes: OFFICE_STAFF_US_FORM_TYPES,
    isEligible: (u) => !isPhBranch(u) && !isBmAndUpRole(u.role) && !isEligibleForTechnicianFormChecklist(u.role, u.extra_roles),
    noun: "office staff",
    formSourceBucket: "new",
  },
  {
    key: "phStaff",
    label: "PH Staff",
    formTypes: PH_STAFF_FORM_TYPES,
    isEligible: (u) => isPhBranch(u),
    noun: "PH staff",
    formSourceBucket: "new",
  },
  {
    key: "bmAndUp",
    label: "BM, SBS, Tech Director, Tech Assistant Director",
    formTypes: BM_AND_UP_FORM_TYPES,
    isEligible: (u) => isBmAndUpRole(u.role),
    noun: "management staff",
    formSourceBucket: "new",
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
  /** profiles.employment_type === "trainee" (Master List) — shown as a badge next to their name; doesn't affect which tab/tier they land in, that's still purely role-based (isEligible above). */
  isTrainee: boolean;
}

function isComplete(doc: SignableDocument | undefined, type: SignableDocumentType): boolean {
  return getDocumentReviewStatus(type, doc) === "done";
}

// Optional "instant preview while refreshing" cache — same sessionStorage
// pattern as TicketList.tsx/ReportHRDaily.tsx's own caches: always still
// fetches for real (see loadUsers/loadDocsForActiveTab below), this just
// paints the roster and the active tab's forms immediately on a repeat
// visit this session instead of a blank spinner while the network round-
// trip completes. Fully guarded — a cache failure silently falls back to
// the normal load. Docs are cached per tab (a separate key per
// ChecklistTabKey) since each tab pulls a different set of document types.
const CHECKLIST_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const CHECKLIST_CACHE_MAX_BYTES = 4 * 1024 * 1024;
const USERS_CACHE_KEY = "ahs:staffchecklist:users-cache:v1";

function readCachedUsers(): ProfileRow[] | null {
  try {
    const raw = sessionStorage.getItem(USERS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; users: ProfileRow[] };
    if (!parsed?.users || Date.now() - parsed.savedAt > CHECKLIST_CACHE_MAX_AGE_MS) return null;
    return parsed.users;
  } catch {
    return null;
  }
}

function writeCachedUsers(users: ProfileRow[]): void {
  try {
    const payload = JSON.stringify({ savedAt: Date.now(), users });
    if (payload.length > CHECKLIST_CACHE_MAX_BYTES) return;
    sessionStorage.setItem(USERS_CACHE_KEY, payload);
  } catch {
    /* storage full/unavailable/private mode — caching is a pure bonus */
  }
}

function docsCacheKey(tab: ChecklistTabKey): string {
  return `ahs:staffchecklist:docs-cache:v1:${tab}`;
}

function readCachedDocs(tab: ChecklistTabKey): Map<string, SignableDocument> | null {
  try {
    const raw = sessionStorage.getItem(docsCacheKey(tab));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; entries: [string, SignableDocument][] };
    if (!parsed?.entries || Date.now() - parsed.savedAt > CHECKLIST_CACHE_MAX_AGE_MS) return null;
    return new Map(parsed.entries);
  } catch {
    return null;
  }
}

function writeCachedDocs(tab: ChecklistTabKey, entries: Map<string, SignableDocument>): void {
  try {
    const payload = JSON.stringify({ savedAt: Date.now(), entries: Array.from(entries.entries()) });
    if (payload.length > CHECKLIST_CACHE_MAX_BYTES) return;
    sessionStorage.setItem(docsCacheKey(tab), payload);
  } catch {
    /* storage full/unavailable/private mode — caching is a pure bonus */
  }
}

type SortMode = "missing-desc" | "missing-asc" | "name" | "branch";

export function TechnicianFormChecklistPage() {
  const navigate = useNavigate();
  const { uid, displayName } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [activeChecklistTab, setActiveChecklistTab] = useState<ChecklistTabKey>("technician");
  // Lazy initializers so a cache hit paints the roster/active tab's forms on
  // the very first render — see the cache helpers above loadUsers/
  // loadDocsForActiveTab further down, which always still fetch for real.
  const [allUsers, setAllUsers] = useState<ProfileRow[]>(() => readCachedUsers() ?? []);
  const [latestByKey, setLatestByKey] = useState<Map<string, SignableDocument>>(() => readCachedDocs("technician") ?? new Map());
  const [exemptions, setExemptions] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hideComplete, setHideComplete] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [search, setSearch] = useState("");
  // A "View in Staff Checklist" link from a chat message (see MessageBody.tsx)
  // arrives as #name=<employee> — same URL-hash deep-link convention
  // TeamMessenger.tsx already uses for #channel=/#dm=. Read once on mount so
  // landing here jumps straight to that person instead of the full list.
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.startsWith("#name=")) setSearch(decodeURIComponent(hash.slice("#name=".length)));
  }, []);
  const [sortMode, setSortMode] = useState<SortMode>("missing-desc");
  // Form + Status filters, e.g. "who still hasn't signed the I-9" or "who's
  // waiting on HR to countersign the W-4" — form defaults to "every form",
  // in which case status matches if ANY of a person's (non-exempt) forms in
  // this tier is in that state, since there's no single "the" form to check.
  const [formTypeFilter, setFormTypeFilter] = useState<SignableDocumentType | "">("");
  const [statusFilter, setStatusFilter] = useState<"" | "done" | "awaiting_hr" | "not_signed">("");
  const [statusPanelHidden, setStatusPanelHidden] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Set to open the "Review & Sign" popup for an "Awaiting HR review" row —
  // shows the employee-signed PDF already on file plus an embedded
  // ManagerReviewPage to add the employer countersignature, all without
  // leaving this page. Only offered for types ManagerReviewPage actually
  // supports (EMPLOYER_SIGN_SUPPORTED_TYPES) — i9's Section 2 needs real
  // document-review fields, not just a signature, so it still points HR at
  // Attendance Monitoring instead.
  const [signDoc, setSignDoc] = useState<SignableDocument | null>(null);
  // Set to open a plain read-only "view" popup for any row's PDF — no
  // signing, just the document with a close button, instead of opening a
  // new browser tab.
  const [viewDoc, setViewDoc] = useState<{ doc: SignableDocument; label: string } | null>(null);
  // Same "plain read-only popup" shape as viewDoc above, just for a License/
  // SSN Card/ID photo instead of a signed document's pdfUrl — those live in
  // a private Storage bucket behind a short-lived signed URL (fetched on
  // click, not cached), not a fixed field on the SignableDocument itself.
  const [idPhotoView, setIdPhotoView] = useState<{ url: string; label: string } | null>(null);

  // ── Contractor Addendum's "Send" step needs Position Level + Guaranteed
  // Minimum Baseline Payout up front — these are compensation/title terms
  // HR sets, not the Contractor's to self-report (matches ReportHRDaily.tsx's
  // own Contractor Addendum send form). Opened in place of an immediate send
  // whenever the row/bundle Send button touches a "contractor_addendum" —
  // see handleSendForm/handleSendAllForms's contractorAddendumInfo param. ──
  const [contractorAddendumSendDialog, setContractorAddendumSendDialog] = useState<
    { kind: "single"; personId: string; personName: string } | { kind: "all"; row: TechRow } | null
  >(null);
  const [contractorAddendumDialogPositionLevel, setContractorAddendumDialogPositionLevel] = useState("");
  const [contractorAddendumDialogBaselinePayout, setContractorAddendumDialogBaselinePayout] = useState("");

  const handleConfirmContractorAddendumSend = () => {
    if (!contractorAddendumSendDialog || !contractorAddendumDialogPositionLevel || !contractorAddendumDialogBaselinePayout.trim()) return;
    const info = { positionLevel: contractorAddendumDialogPositionLevel, baselinePayout: contractorAddendumDialogBaselinePayout.trim() };
    if (contractorAddendumSendDialog.kind === "single") {
      void handleSendForm(contractorAddendumSendDialog.personId, contractorAddendumSendDialog.personName, "contractor_addendum", info);
    } else {
      void handleSendAllForms(contractorAddendumSendDialog.row, info);
    }
    setContractorAddendumSendDialog(null);
    setContractorAddendumDialogPositionLevel("");
    setContractorAddendumDialogBaselinePayout("");
  };

  // ── Form W-4's "Employers Only" step — no employer signature line on the
  // form at all, just 3 text fields (name/address, first date of
  // employment, EIN). Mirrors ReportHRDaily.tsx's handleOpenW4EmployerDialog/
  // handleSaveW4EmployerInfo exactly (same fillW4Pdf/uploadW4Form/
  // updateSignableDocumentPdfUrl/confirmSignableDocument calls), just
  // reloading this tab's own documents afterward instead of
  // loadSentW4Forms(). ──
  const [w4EmployerDialog, setW4EmployerDialog] = useState<SignableDocument | null>(null);
  const [w4EmployerNameAddress, setW4EmployerNameAddress] = useState("");
  const [w4EmployerFirstDate, setW4EmployerFirstDate] = useState("");
  const [w4EmployerEin, setW4EmployerEin] = useState("");
  const [w4EmployerSaving, setW4EmployerSaving] = useState(false);
  const [w4EmployerError, setW4EmployerError] = useState<string | null>(null);

  const handleOpenW4EmployerDialog = (doc: SignableDocument) => {
    setW4EmployerDialog(doc);
    setW4EmployerNameAddress("");
    setW4EmployerFirstDate("");
    setW4EmployerEin("");
    setW4EmployerError(null);
  };

  const handleSaveW4EmployerInfo = async () => {
    if (!w4EmployerDialog) return;
    setW4EmployerSaving(true);
    setW4EmployerError(null);
    try {
      const data = w4EmployerDialog.formData as W4FormData;
      const merged: W4FormData = {
        ...data,
        employerNameAndAddress: w4EmployerNameAddress,
        employerFirstDateOfEmployment: w4EmployerFirstDate,
        employerEin: w4EmployerEin,
      };
      const sigBytes = data.signatureDataUrl
        ? new Uint8Array(await (await fetch(data.signatureDataUrl)).arrayBuffer())
        : undefined;
      const pdfBytes = await fillW4Pdf(merged, sigBytes);
      const employeeName = `${data.firstNameMiddleInitial ?? ""} ${data.lastName ?? ""}`.trim();
      const pdfUrl = await uploadW4Form(w4EmployerDialog.companyId, employeeName, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));
      await updateSignableDocumentPdfUrl(w4EmployerDialog.id, pdfUrl, merged as unknown as Record<string, any>);
      await confirmSignableDocument(w4EmployerDialog.id, null);
      setW4EmployerDialog(null);
      await loadDocsForActiveTab();
    } catch (err) {
      setW4EmployerError(err instanceof Error ? err.message : "Failed to save employer info.");
    } finally {
      setW4EmployerSaving(false);
    }
  };

  const activeConfig = useMemo(() => CHECKLIST_TABS.find((t) => t.key === activeChecklistTab) ?? CHECKLIST_TABS[0], [activeChecklistTab]);

  useEffect(() => {
    if (!uid) return;
    getMyProfileId(uid).then(setMyProfileId).catch(() => setMyProfileId(null));
  }, [uid]);

  // The roster doesn't vary per tab — fetched once (and on manual Refresh),
  // not re-pulled every time the active tab changes.
  const [usersLoading, setUsersLoading] = useState(() => readCachedUsers() === null);
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const users = (await getCompanyUsers() as ProfileRow[]).filter((u) => u.is_active);
      setAllUsers(users);
      writeCachedUsers(users);
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
  const [docsLoading, setDocsLoading] = useState(() => readCachedDocs("technician") === null);
  const loadDocsForActiveTab = useCallback(async () => {
    // Paint instantly from that tab's own cached copy (if any) while the
    // real fetch below still always runs — covers switching TO a tab
    // visited earlier this session, not just the very first mount.
    const cachedForTab = readCachedDocs(activeConfig.key);
    if (cachedForTab) {
      setLatestByKey(cachedForTab);
      setDocsLoading(false);
    } else {
      setDocsLoading(true);
    }
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
        // Only w4/i9/direct_deposit/w8ben are actually shared between an
        // old and a new tab — see SHARED_OLD_NEW_AUTOMATION_TYPES's doc
        // comment. A doc of one of those types that isn't from this tab's
        // own bucket doesn't count toward this tab's checklist at all —
        // without this, e.g. New Technician's W-4 row showed "done" off an
        // old-flow W-4 submission it never actually sent.
        if (SHARED_OLD_NEW_AUTOMATION_TYPES.has(d.documentType) && isNewAutomationDoc(d) !== (activeConfig.formSourceBucket === "new")) continue;
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
      writeCachedDocs(activeConfig.key, latest);
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

  // A form sent/signed from somewhere else (HR Dashboard, a technician's own
  // fill link, etc.) has no way to push an update here — this page only
  // fetches once on mount/tab-switch, so a tab left open for a while quietly
  // goes stale ("Not sent" for a form that's actually already signed and
  // waiting on HR). Catching up on refocus — same fix TimeClockMenu.tsx/
  // MessagesMenu.tsx already use for the same "long-open tab" staleness —
  // means coming back to this tab always shows current status without
  // needing to remember to click Refresh.
  useEffect(() => onTabVisible(() => void load()), [load]);

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
        isTrainee: u.employment_type === "trainee",
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
    // Each tier has its own form list, so a form picked under one tier
    // (e.g. "Contractor Addendum" under BM+) may not exist under another.
    setFormTypeFilter("");
    setStatusFilter("");
  };

  const branchOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.branch))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const formOptions = useMemo(
    () => activeConfig.formTypes.map((type) => ({ type, label: SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type })),
    [activeConfig]
  );

  /** True if any of `types` is in `status` for row `r`, skipping forms
   *  marked Not Applicable — an exemption isn't "not signed", it's out of
   *  scope entirely, same as it's excluded from doneCount/applicableTotal. */
  const rowHasStatus = (r: TechRow, types: SignableDocumentType[], status: DocumentReviewStatus) =>
    types.some((type) => !r.exempt.has(type) && getDocumentReviewStatus(type, r.docs.get(type)) === status);

  // Once a specific Form is picked in the floating filter, break the whole
  // tier's roster (not just whatever the Search/Branch text filters happen
  // to leave visible) into who's Signed/Not Signed/Waiting for HR on THAT
  // form — the Status dropdown alone only ever shows one bucket at a time,
  // but seeing all three side by side per form is the more useful view.
  const formStatusGroups = useMemo(() => {
    if (!formTypeFilter) return null;
    const signed: string[] = [];
    const notSigned: string[] = [];
    const awaitingHr: string[] = [];
    for (const r of rows) {
      if (r.exempt.has(formTypeFilter)) continue;
      const status = getDocumentReviewStatus(formTypeFilter, r.docs.get(formTypeFilter));
      if (status === "done") signed.push(r.name);
      else if (status === "awaiting_hr") awaitingHr.push(r.name);
      else notSigned.push(r.name);
    }
    const byName = (a: string, b: string) => a.localeCompare(b);
    return { signed: signed.sort(byName), notSigned: notSigned.sort(byName), awaitingHr: awaitingHr.sort(byName) };
  }, [rows, formTypeFilter]);

  const visibleRows = useMemo(() => {
    let result = rows;
    if (hideComplete) result = result.filter((r) => r.doneCount < r.applicableTotal);
    if (branchFilter) result = result.filter((r) => r.branch === branchFilter);
    if (statusFilter) {
      const checkTypes = formTypeFilter ? [formTypeFilter] : activeConfig.formTypes;
      const targets: DocumentReviewStatus[] = statusFilter === "not_signed" ? ["not_sent", "awaiting_employee"] : [statusFilter];
      result = result.filter((r) => targets.some((t) => rowHasStatus(r, checkTypes, t)));
    }
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
  const handleSendForm = async (
    personId: string,
    personName: string,
    type: SignableDocumentType,
    contractorAddendumInfo?: { positionLevel: string; baselinePayout: string }
  ) => {
    const key = `${personId}|${type}`;
    setActionKey(key);
    setActionError(null);
    try {
      // Guard against two HR sessions racing on the same stale "Not sent"
      // row — e.g. one person sends this form from their own laptop right
      // before another session (which hasn't refreshed since) clicks Send
      // for the same person/form here too. `rows` is only as fresh as this
      // session's last load, so re-check the LIVE database state right
      // before creating anything rather than trusting the row that's
      // currently on screen. Refuses rather than asking "send another
      // anyway?" (unlike ReportHRDaily.tsx's own send handlers) — from this
      // checklist, "Send" only ever means "this hasn't been sent yet", so a
      // hit here means the screen was wrong, not that HR actually wants a
      // second one.
      const alreadySent = await getExistingActiveDocumentTypes(personId, [type]);
      if (alreadySent.length > 0) {
        setActionError(`${personName} already has a ${SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type} on file (most likely just sent from another session) — refreshing to show its current status.`);
        await loadDocsForActiveTab();
        return;
      }
      // Tag with the active tab's own formSource bucket whenever it's
      // "new" — matches ReportHRDaily.tsx's own send handlers (tag purely
      // on which tab the send happened from, not on the type). This
      // checklist itself only bucket-filters SHARED_OLD_NEW_AUTOMATION_TYPES
      // types when deciding what counts as "done" (see loadDocsForActiveTab),
      // but ReportHRDaily.tsx's own Sent History tables for w4/i9/
      // direct_deposit still do — so a W-4 sent from here while on the New
      // Technician tab needs the tag regardless, or it'd wrongly show up
      // under the OLD w8ben tab's Sent History instead of newW4's.
      const formSourceTag = activeConfig.formSourceBucket === "new" ? { formSource: "new_automation" } : {};
      // Position Level / Guaranteed Minimum Baseline Payout are compensation
      // terms HR sets, not the Contractor's to self-report — see
      // contractorAddendumSendDialog below, which collects these before this
      // function ever runs for a contractor_addendum send.
      const contractorAddendumFields = type === "contractor_addendum" && contractorAddendumInfo
        ? { positionLevel: contractorAddendumInfo.positionLevel, baselinePayout: contractorAddendumInfo.baselinePayout }
        : {};
      const doc = await createSignableDocument({
        documentType: type,
        formData: { employeeId: personId, employeeName: personName, ...formSourceTag, ...contractorAddendumFields },
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

  // "Send All Forms" — bundles every one of this tab's forms this person
  // hasn't been sent yet (skipping N/A'd and already-sent/signed ones) into
  // ONE /sign-bundle link and DMs it immediately — no detour through
  // ReportHRDaily's Bulk Form Send picker for review first. Same mechanism
  // Bulk Form Send itself uses (see handleGenerateCombinedForms there):
  // each form still gets its own independent hr_signable_documents row
  // created via the exact same createSignableDocument call handleSendForm
  // above makes one at a time, so every form's status keeps tracking
  // separately here — "the bundle" is nothing but their ids joined into one
  // query string for delivery. load() afterward picks all of them up
  // individually, same as any other send.
  const handleSendAllForms = async (r: TechRow, contractorAddendumInfo?: { positionLevel: string; baselinePayout: string }) => {
    const outstanding = activeConfig.formTypes.filter(
      (type) => !r.exempt.has(type) && getDocumentReviewStatus(type, r.docs.get(type)) === "not_sent"
    );
    if (outstanding.length === 0) return;
    const key = `${r.profileId}|sendAll`;
    setActionKey(key);
    setActionError(null);
    try {
      // Same race guard as handleSendForm (see its own comment) — re-check
      // the live database right before creating anything, in case another
      // session already sent one or more of these since this session's
      // last load.
      const alreadyActive = await getExistingActiveDocumentTypes(r.profileId, outstanding);
      const toCreate = outstanding.filter((type) => !alreadyActive.includes(type));
      if (toCreate.length === 0) {
        setActionError(`${r.name} already has all of these on file (most likely just sent from another session) — refreshing to show current status.`);
        await loadDocsForActiveTab();
        return;
      }
      // Same tag handleSendForm applies (see its own comment) — tags with
      // the active tab's formSource bucket whenever it's "new", so a bundle
      // sent from e.g. the New Technician tab still lands under newW4's/
      // newW9's/etc. Sent History rather than the old shared tab's.
      const formSourceTag = activeConfig.formSourceBucket === "new" ? { formSource: "new_automation" } : {};
      const docs = await Promise.all(
        toCreate.map((type) =>
          createSignableDocument({
            documentType: type,
            formData: {
              employeeId: r.profileId,
              employeeName: r.name,
              ...formSourceTag,
              // Same reasoning as handleSendForm above — only applies to the
              // contractor_addendum entry in this bundle, if present.
              ...(type === "contractor_addendum" && contractorAddendumInfo
                ? { positionLevel: contractorAddendumInfo.positionLevel, baselinePayout: contractorAddendumInfo.baselinePayout }
                : {}),
            },
            recipientId: r.profileId,
            recipientSlot: "employee",
            pdfUrl: "",
          })
        )
      );
      if (myProfileId) {
        const thread = await getOrCreateDmThread(myProfileId, r.profileId);
        const bundleLink = `${getAppUrl()}/sign-bundle?ids=${docs.map((d) => d.id).join(",")}`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "HR",
          body: `📋 Please complete these ${docs.length} forms: ${bundleLink}`,
        });
      }
      void logActivity({
        action: "combined_forms_sent",
        targetType: "employee",
        targetId: r.profileId,
        targetLabel: r.name,
        details: { types: toCreate },
      });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send forms.");
    } finally {
      setActionKey(null);
    }
  };

  // "Remind All" — the bulk counterpart to handleRemindForm: every one of
  // this tab's forms already sent and awaiting the employee's own signature
  // (skipping N/A'd, not-yet-sent, and awaiting-HR/done ones) gets ONE DM
  // with a single /sign-bundle link over their EXISTING document ids — no
  // new hr_signable_documents rows created, same as an individual reminder
  // just re-nudges the same doc rather than resending it.
  const handleRemindAllForms = async (r: TechRow) => {
    const pending = activeConfig.formTypes
      .filter((type) => !r.exempt.has(type) && getDocumentReviewStatus(type, r.docs.get(type)) === "awaiting_employee")
      .map((type) => r.docs.get(type))
      .filter((doc): doc is SignableDocument => !!doc);
    if (pending.length === 0 || !myProfileId) return;
    const key = `${r.profileId}|remindAll`;
    setActionKey(key);
    setActionError(null);
    try {
      const thread = await getOrCreateDmThread(myProfileId, r.profileId);
      const bundleLink = `${getAppUrl()}/sign-bundle?ids=${pending.map((d) => d.id).join(",")}`;
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: `⏰ Reminder — please complete these ${pending.length} forms: ${bundleLink}`,
      });
      void logActivity({
        action: "combined_forms_reminded",
        targetType: "employee",
        targetId: r.profileId,
        targetLabel: r.name,
        details: { types: pending.map((d) => d.documentType) },
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send reminder.");
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

  // HR's "reviewed this ID photo" checkbox (ID_DOC_FIELDS) — a plain flag on
  // the document's own form_data, keyed per field so e.g. master_w2_agreement's
  // separate License/SSN Card photos each track independently. Not part of
  // the sign/countersign flow at all, purely a "someone on HR actually
  // looked at this" record.
  const handleToggleIdVerified = async (doc: SignableDocument, personId: string, type: SignableDocumentType, field: string) => {
    const key = `${personId}|${type}|${field}`;
    const verifiedField = `${field}Verified`;
    const nextFormData = { ...doc.formData, [verifiedField]: !doc.formData?.[verifiedField] };
    setActionKey(key);
    setActionError(null);
    try {
      await updateSignableDocumentFormData(doc.id, nextFormData);
      setLatestByKey((prev) => {
        const mapKey = `${personId}|${type}`;
        const existing = prev.get(mapKey);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(mapKey, { ...existing, formData: nextFormData });
        return next;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update.");
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
    <>
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
        {(search || branchFilter || sortMode !== "missing-desc" || hideComplete || statusFilter || formTypeFilter) && (
          <button
            type="button"
            onClick={() => { setSearch(""); setBranchFilter(""); setSortMode("missing-desc"); setHideComplete(false); setStatusFilter(""); setFormTypeFilter(""); }}
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
            {rows.length === 0
              ? `No ${activeConfig.noun} found.`
              : search.trim()
              ? `No ${activeConfig.noun.slice(0, -1)} matches "${search.trim()}".`
              : statusFilter || formTypeFilter
              ? `No ${activeConfig.noun} match that Status/Form filter.`
              : `Every one of these ${activeConfig.noun} is fully signed up.`}
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
                        {r.isTrainee && <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">Trainee</span>}
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
                    {(() => {
                      const outstanding = activeConfig.formTypes.filter(
                        (type) => !r.exempt.has(type) && getDocumentReviewStatus(type, r.docs.get(type)) === "not_sent"
                      );
                      const pending = activeConfig.formTypes.filter(
                        (type) => !r.exempt.has(type) && getDocumentReviewStatus(type, r.docs.get(type)) === "awaiting_employee"
                      );
                      const remindAllBusy = actionKey === `${r.profileId}|remindAll`;
                      const sendAllBusy = actionKey === `${r.profileId}|sendAll`;
                      if (outstanding.length === 0 && pending.length === 0) return null;
                      return (
                        <div className="flex justify-end items-center gap-3 mb-2.5">
                          {pending.length > 0 && (
                            <button
                              type="button"
                              disabled={remindAllBusy}
                              onClick={() => void handleRemindAllForms(r)}
                              title={`Send one reminder for the ${pending.length} form${pending.length === 1 ? "" : "s"} awaiting their signature`}
                              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-400 hover:text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {remindAllBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                              Remind All{pending.length > 0 ? ` (${pending.length})` : ""}
                            </button>
                          )}
                          {outstanding.length > 0 && (
                            <button
                              type="button"
                              disabled={sendAllBusy}
                              onClick={() =>
                                outstanding.includes("contractor_addendum")
                                  ? setContractorAddendumSendDialog({ kind: "all", row: r })
                                  : void handleSendAllForms(r)
                              }
                              title={`Bundle the ${outstanding.length} unsent form${outstanding.length === 1 ? "" : "s"} into one link and send now`}
                              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {sendAllBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                              Send All Forms ({outstanding.length})
                            </button>
                          )}
                        </div>
                      );
                    })()}
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
                        const idDocFields = !na && doc ? (ID_DOC_FIELDS[type] ?? []).filter(({ field }) => doc.formData?.[field]) : [];
                        return (
                          <Fragment key={type}>
                          <li className={`flex items-center gap-2.5 text-sm ${na ? "opacity-50" : ""}`}>
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${markerClass}`}>
                              {done && <span className="text-[10px] font-bold leading-none">✓</span>}
                            </span>
                            <span className={`flex-1 min-w-0 ${done ? "text-slate-400" : "text-slate-200"}`}>{label}</span>
                            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${statusColor}`}>
                              {statusText}
                            </span>
                            {!na && doc?.pdfUrl && (
                              <button
                                type="button"
                                onClick={() => setViewDoc({ doc: doc!, label })}
                                className="inline-flex shrink-0 items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300"
                              >
                                view <ExternalLink className="h-3 w-3" />
                              </button>
                            )}
                            {!na && done && doc && doc.status === "confirmed" && EMPLOYER_SIGN_SUPPORTED_TYPES.has(type) && (
                              <button
                                type="button"
                                onClick={() => setSignDoc(doc)}
                                title="Not right? Redo just the employer signature — nothing else on the form changes"
                                className="inline-flex shrink-0 items-center gap-0.5 text-xs text-amber-300 hover:text-amber-200"
                              >
                                <PenLine className="h-3 w-3" /> Re-sign
                              </button>
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
                              type === "w4" && doc ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenW4EmployerDialog(doc)}
                                  title='Fill in the "Employers Only" box — no signature, just employer name/address, first date of employment, and EIN'
                                  className="inline-flex shrink-0 items-center gap-1 text-xs text-sky-300 hover:text-sky-200"
                                >
                                  <PenLine className="h-3 w-3" /> Fill Info
                                </button>
                              ) : doc && EMPLOYER_SIGN_SUPPORTED_TYPES.has(type) ? (
                                <button
                                  type="button"
                                  onClick={() => setSignDoc(doc)}
                                  title="Review the signed document and add your signature here"
                                  className="inline-flex shrink-0 items-center gap-1 text-xs text-sky-300 hover:text-sky-200"
                                >
                                  <PenLine className="h-3 w-3" /> Sign
                                </button>
                              ) : type === "i9" && doc ? (
                                // Section 2 needs real document-review fields
                                // (documents examined, first day employed,
                                // business info) — not just a signature, so
                                // there's no in-page popup for it here.
                                // Deep-links straight to that person's
                                // Section 2 dialog in HR Paperworks instead
                                // of leaving HR to go find it manually — see
                                // ReportHRDaily.tsx's restoredI9Section2Ref.
                                <button
                                  type="button"
                                  onClick={() =>
                                    navigate({
                                      to: "/m/$module/$submodule",
                                      params: { module: "hr", submodule: "hr-paperworks" },
                                      search: { tab: activeConfig.formSourceBucket === "new" ? "newI9" : "i9", docId: doc.id },
                                    } as any)
                                  }
                                  title="Complete Section 2 in HR Paperworks"
                                  className="inline-flex shrink-0 items-center gap-1 text-xs text-sky-300 hover:text-sky-200"
                                >
                                  <ExternalLink className="h-3 w-3" /> Complete Section 2
                                </button>
                              ) : (
                                <span title="This person has signed — this form now needs HR's own review/countersignature in Attendance Monitoring." className="shrink-0 text-[10px] text-sky-400/80">
                                  Needs your review
                                </span>
                              )
                            )}
                            {!na && reviewStatus === "not_sent" && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  type === "contractor_addendum"
                                    ? setContractorAddendumSendDialog({ kind: "single", personId: r.profileId, personName: r.name })
                                    : void handleSendForm(r.profileId, r.name, type)
                                }
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
                          {idDocFields.map(({ field, label: fieldLabel }) => {
                            const idKey = `${r.profileId}|${type}|${field}`;
                            const idBusy = actionKey === idKey;
                            const verified = !!doc!.formData?.[`${field}Verified`];
                            return (
                            <li key={field} className="flex items-center gap-2.5 text-sm pl-6">
                              <button
                                type="button"
                                disabled={idBusy}
                                onClick={() => void handleToggleIdVerified(doc!, r.profileId, type, field)}
                                title={verified ? "Reviewed — click to unmark" : "Mark this ID photo as reviewed"}
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border disabled:opacity-40 ${verified ? "border-emerald-500 bg-emerald-500 text-slate-950" : "border-white/20 bg-transparent hover:border-white/40"}`}
                              >
                                {verified && <span className="text-[10px] font-bold leading-none">✓</span>}
                              </button>
                              <span className={`flex-1 min-w-0 ${verified ? "text-slate-500" : "text-slate-400"}`}>{fieldLabel}</span>
                              {verified && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Reviewed</span>}
                              <button
                                type="button"
                                onClick={() =>
                                  getTechnicianIdDocumentUrl(doc!.formData[field])
                                    .then((url) => setIdPhotoView({ url, label: fieldLabel }))
                                    .catch((err) => setActionError(err instanceof Error ? err.message : `Failed to open ${fieldLabel} photo.`))
                                }
                                className="inline-flex shrink-0 items-center gap-0.5 text-xs text-blue-400 hover:text-blue-300"
                              >
                                view <ExternalLink className="h-3 w-3" />
                              </button>
                            </li>
                            );
                          })}
                          </Fragment>
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

    {/* Floating Status/Form filter — pinned to the viewport (not the
        scrolling <main> column) so it's reachable no matter how far down
        the roster list you've scrolled. Same fixed-right-rail pattern as
        AbsentListPage.tsx's own floating stats card. */}
    {statusPanelHidden ? (
      <button
        type="button"
        onClick={() => setStatusPanelHidden(false)}
        title="Signed filter"
        className="fixed right-3 top-20 z-40 rounded-full border border-white/10 bg-slate-900/90 p-3.5 shadow-lg backdrop-blur-md text-slate-400 hover:text-white transition"
      >
        <Filter className="h-6 w-6" />
      </button>
    ) : (
      <div
        className={`fixed right-3 top-20 z-40 rounded-2xl border border-white/10 bg-slate-900/90 p-3 shadow-lg backdrop-blur-md max-h-[85vh] overflow-y-auto transition-[width] ${
          formStatusGroups ? "w-[26rem]" : "w-56"
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-white">Filter</span>
          <button type="button" onClick={() => setStatusPanelHidden(true)} title="Hide" className="text-slate-500 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded-lg border border-white/15 bg-slate-900/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Any status</option>
              <option value="done">Signed</option>
              <option value="not_signed">Not signed</option>
              <option value="awaiting_hr">Awaiting HR Review</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Form</label>
            <select
              value={formTypeFilter}
              onChange={(e) => setFormTypeFilter(e.target.value as SignableDocumentType | "")}
              className="rounded-lg border border-white/15 bg-slate-900/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">All forms</option>
              {formOptions.map((f) => <option key={f.type} value={f.type}>{f.label}</option>)}
            </select>
          </div>
          {(statusFilter || formTypeFilter) && (
            <button
              type="button"
              onClick={() => { setStatusFilter(""); setFormTypeFilter(""); }}
              className="text-[11px] text-blue-400 hover:text-blue-300 text-left"
            >
              Clear
            </button>
          )}
        </div>

        {formStatusGroups && (
          <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-3">
            {(
              [
                { key: "signed", status: "done", label: "Signed", names: formStatusGroups.signed, dot: "bg-emerald-400", text: "text-emerald-300" },
                { key: "notSigned", status: "not_signed", label: "Not Signed", names: formStatusGroups.notSigned, dot: "bg-red-400", text: "text-red-300" },
                { key: "awaitingHr", status: "awaiting_hr", label: "Awaiting HR Review", names: formStatusGroups.awaitingHr, dot: "bg-amber-400", text: "text-amber-300" },
              ] as const
            )
              // The Status dropdown now actually narrows this list down to
              // just the picked bucket instead of always showing all three
              // regardless of what Status says — that mismatch was the
              // "status filter not working" bug: Status="Signed" changed
              // the roster below but visibly did nothing to this panel.
              .filter((g) => !statusFilter || g.status === statusFilter)
              .map((g) => (
              <div key={g.key}>
                <p className={`text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5 ${g.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${g.dot}`} /> {g.label} ({g.names.length})
                </p>
                {g.names.length === 0 ? (
                  <p className="text-[11px] text-slate-500 mt-1">— none —</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {g.names.map((n) => (
                      <li key={n} className="text-xs text-slate-300 truncate" title={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )}

    {/* Plain read-only "view" popup — just the PDF and a close button, no
        signing. Opened from the "view" link/button on any row that has a
        pdfUrl, regardless of status. */}
    {viewDoc && (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setViewDoc(null)}>
        <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-[95vw] h-[95vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
            <p className="text-sm font-semibold truncate">{viewDoc.label}</p>
            <button
              type="button"
              onClick={() => setViewDoc(null)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden bg-slate-950">
            {viewDoc.doc.pdfUrl && <iframe src={viewDoc.doc.pdfUrl} title={viewDoc.label} className="w-full h-full border-0" />}
          </div>
        </div>
      </div>
    )}

    {/* Same plain read-only popup, for a License/SSN Card/ID photo — see
        idPhotoView's own comment above. */}
    {idPhotoView && (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setIdPhotoView(null)}>
        <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-[95vw] h-[95vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
            <p className="text-sm font-semibold truncate">{idPhotoView.label}</p>
            <button
              type="button"
              onClick={() => setIdPhotoView(null)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto bg-slate-950 flex items-center justify-center p-4">
            {/* A plain <img>, not an <iframe> — an iframe hands an image off
                to the browser's own standalone image viewer, which renders
                it at native pixel size (100% zoom) instead of scaling to
                fit, so a real camera-resolution ID photo overflowed the
                popup instead of fitting inside it. object-contain scales it
                down to fit while still letting it grow up to its own
                natural size on a small photo. */}
            <img src={idPhotoView.url} alt={idPhotoView.label} className="max-w-full max-h-full object-contain" />
          </div>
        </div>
      </div>
    )}

    {/* "Review & Sign" popup — the employee-signed PDF already on file
        (same one the "view" popup above shows) plus an embedded
        ManagerReviewPage so HR can add the employer countersignature right
        here, no navigation to Attendance Monitoring needed. */}
    {signDoc && (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { setSignDoc(null); void loadDocsForActiveTab(); }}>
        <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
            <p className="text-sm font-semibold flex items-center gap-1.5"><PenLine className="h-4 w-4" /> Review &amp; Sign</p>
            <button
              type="button"
              onClick={() => { setSignDoc(null); void loadDocsForActiveTab(); }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {signDoc.pdfUrl && (
              <div className="mb-4 rounded-md overflow-hidden border border-white/10 bg-white/5">
                <iframe src={signDoc.pdfUrl} title="Document on file" className="w-full border-0" style={{ height: 380 }} />
              </div>
            )}
            <ManagerReviewPage docId={signDoc.id} embedded onSigned={() => void loadDocsForActiveTab()} />
          </div>
        </div>
      </div>
    )}

    {/* Form W-4 "Fill Employer Info" popup — no signature on this form,
        just the 3 "Employers Only" text fields. Same fields/labels/flow as
        ReportHRDaily.tsx's own w4EmployerDialog. */}
    {w4EmployerDialog && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
          <h3 className="text-lg font-bold mb-2">Fill Employer Info</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Completes the "Employers Only" box on{" "}
            <span className="font-semibold text-white">
              {(() => {
                const data = w4EmployerDialog.formData as Partial<W4FormData>;
                return `${data.firstNameMiddleInitial ?? ""} ${data.lastName ?? ""}`.trim();
              })()}
            </span>
            's submitted W-4.
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employer's name and address</label>
              <textarea value={w4EmployerNameAddress} onChange={(e) => setW4EmployerNameAddress(e.target.value)} rows={2} className="glass-input text-sm py-1.5 px-3 rounded-md resize-y" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">First date of employment</label>
              <input type="date" value={w4EmployerFirstDate} onChange={(e) => setW4EmployerFirstDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Employer identification number (EIN)</label>
              <input type="text" placeholder="XX-XXXXXXX" value={w4EmployerEin} onChange={(e) => setW4EmployerEin(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
          </div>
          {w4EmployerError && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{w4EmployerError}</p>
          )}
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setW4EmployerDialog(null)} className="btn text-sm px-4 py-2">Cancel</button>
            <button
              onClick={handleSaveW4EmployerInfo}
              disabled={w4EmployerSaving}
              className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {w4EmployerSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Contractor Addendum "Send" — collects Position Level + Guaranteed
        Minimum Baseline Payout up front, same rationale as ReportHRDaily.tsx's
        own send form: these are compensation/title terms HR decides, not the
        Contractor's to self-report. */}
    {contractorAddendumSendDialog && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full">
          <h3 className="text-lg font-bold mb-2">Send Master Independent Contractor Subcontractor Agreement Addendum</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Set these before sending to{" "}
            <span className="font-semibold text-white">
              {contractorAddendumSendDialog.kind === "single" ? contractorAddendumSendDialog.personName : contractorAddendumSendDialog.row.name}
            </span>
            . The Contractor then only fills in their name and signs.
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Position Level</label>
              <select
                value={contractorAddendumDialogPositionLevel}
                onChange={(e) => setContractorAddendumDialogPositionLevel(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md"
              >
                <option value="">Select a position level…</option>
                {CONTRACTOR_ADDENDUM_POSITION_LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Guaranteed Minimum Baseline Payout ($/month)</label>
              <input
                type="text"
                inputMode="decimal"
                value={contractorAddendumDialogBaselinePayout}
                onChange={(e) => setContractorAddendumDialogBaselinePayout(e.target.value)}
                placeholder="e.g. 4500"
                className="glass-input text-sm py-1.5 px-3 rounded-md"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <button onClick={() => setContractorAddendumSendDialog(null)} className="btn text-sm px-4 py-2">Cancel</button>
            <button
              onClick={handleConfirmContractorAddendumSend}
              disabled={!contractorAddendumDialogPositionLevel || !contractorAddendumDialogBaselinePayout.trim()}
              className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
