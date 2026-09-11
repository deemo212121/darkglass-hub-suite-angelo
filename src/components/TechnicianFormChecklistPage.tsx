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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ClipboardCheck, Loader2, ChevronDown, ExternalLink, RefreshCw, Send, Bell, Snowflake, Search, X, PenLine } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ManagerReviewPage, SUPPORTED_TYPES as EMPLOYER_SIGN_SUPPORTED_TYPES } from "@/components/ManagerReviewPage";
import { getCompanyUsers, getMyProfileId, setProfileFrozen, type ProfileRow } from "@/lib/supabase/users";
import { isEligibleForTechnicianFormChecklist, isBmAndUpRole, getRoleDepartmentBreakdown } from "@/lib/roleLabels";
import { getSignableDocumentsByTypes, getExistingActiveDocumentTypes, createSignableDocument, type SignableDocument, type SignableDocumentType } from "@/lib/supabase/signableDocuments";
import { SIGNABLE_DOCUMENT_REGISTRY, TECHNICIAN_FORM_TYPES, getDocumentReviewStatus, isTechnicianExemptFromForm, exemptionRowValueForToggle, pickAuthoritativeDocument, isNewAutomationDoc, SHARED_OLD_NEW_AUTOMATION_TYPES } from "@/lib/signableDocumentRegistry";
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
  // Set to open the "Review & Sign" popup for an "Awaiting HR review" row —
  // shows the employee-signed PDF already on file plus an embedded
  // ManagerReviewPage to add the employer countersignature, all without
  // leaving this page. Only offered for types ManagerReviewPage actually
  // supports (EMPLOYER_SIGN_SUPPORTED_TYPES) — i9's Section 2 needs real
  // document-review fields, not just a signature, so it still points HR at
  // Attendance Monitoring instead.
  const [signDoc, setSignDoc] = useState<SignableDocument | null>(null);

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
      const doc = await createSignableDocument({
        documentType: type,
        formData: { employeeId: personId, employeeName: personName, ...formSourceTag },
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
  const handleSendAllForms = async (r: TechRow) => {
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
            formData: { employeeId: r.profileId, employeeName: r.name, ...formSourceTag },
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
                              onClick={() => void handleSendAllForms(r)}
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
                              doc && EMPLOYER_SIGN_SUPPORTED_TYPES.has(type) ? (
                                <button
                                  type="button"
                                  onClick={() => setSignDoc(doc)}
                                  title="Review the signed document and add your signature here"
                                  className="inline-flex shrink-0 items-center gap-1 text-xs text-sky-300 hover:text-sky-200"
                                >
                                  <PenLine className="h-3 w-3" /> Sign
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

    {/* "Review & Sign" popup — the employee-signed PDF already on file
        (same one the "view" link opens in a new tab) plus an embedded
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
    </>
  );
}
