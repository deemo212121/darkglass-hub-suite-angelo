/**
 * Shared notification-loading logic for NotificationsMenu.tsx (the header
 * bell dropdown) and NotificationCenterPage.tsx (the full "view all" page,
 * both desktop and mobile) — extracted so both surfaces stay in sync
 * without duplicating the merge/subscribe/mark-read logic.
 *
 * Deliberately excludes system-kind DMs — those are genuine messages (e.g.
 * Attendance Monitoring's "Notify Individual"/"Notify Team Lead" alerts),
 * and already have their own home in MessagesMenu/the internal messenger.
 * Showing them here too would duplicate the same item in two different
 * bells. This hook only merges the two true "notification" sources:
 *
 *  1. The dedicated `notifications` table (see migration 0035) — alerts
 *     that should never show up as a message (e.g. "new employee request
 *     submitted"). These can carry a `linkTo` so clicking one navigates
 *     straight to the relevant page.
 *  2. HR only: a realtime Firestore subscription (notifications/{uid}/items
 *     via subscribeNotifications) — the existing
 *     sendNotificationToRole()/users_index Firestore architecture, and how
 *     the Jotform webhook (api/jotform.ts) delivers "New Form Submitted"
 *     pings since a Cloudflare Worker can't run the Supabase-scoped,
 *     session-based write path the other source uses. Chimes on genuinely
 *     new arrivals (not on the first snapshot after subscribing).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId, getMyRoles } from "@/lib/supabase/users";
import {
  getMyNotifications,
  markNotificationRead,
  markNotificationUnread,
  markAllNotificationsRead,
  deleteNotification,
  setNotificationStarred,
  subscribeToMyNotifications,
  type NotificationRow,
} from "@/lib/supabase/notifications";
import {
  subscribeNotifications,
  markNotificationRead as markFirestoreNotificationRead,
  markNotificationUnread as markFirestoreNotificationUnread,
  markAllNotificationsRead as markAllFirestoreNotificationsRead,
  deleteNotification as deleteFirestoreNotification,
  setNotificationStarred as setFirestoreNotificationStarred,
  type AppNotification,
} from "@/lib/firebase/notifications";
import { playNotifySound } from "@/lib/notifySound";
import { getModule, getSubModule } from "@/lib/modules";

export interface MergedNotif {
  id: string;
  source: "table" | "firestore";
  senderName: string | null;
  body: string;
  createdAt: string;
  isRead: boolean;
  /** Gmail-style flag to come back to later — independent of isRead. */
  starred: boolean;
  linkTo: string | null;
  /** Human-readable grouping label for the Notification Center — see categoryFor(). */
  category: string;
  /** Finer-grained grouping WITHIN a category — see subjectFor(). A department tab like "HR" still mixes timecard-correction status pings, signed-form notices, and Jotform submissions; subject splits those apart. */
  subject: string;
}

/**
 * Firestore-only: NotifKind -> department. A more direct signal of "what
 * is this actually about" than the link for kinds whose click-through
 * destination is a generic page (e.g. restock_auto links to a ticket
 * detail page, but the notification itself is a Parts-team concern, not
 * a ticket-dispatch one) — see categoryFor()'s priority order. "system"
 * is intentionally absent: too generic to mean any one department.
 */
const DEPARTMENT_BY_KIND: Partial<Record<AppNotification["kind"], string>> = {
  part_status_change: "Parts",
  cross_inventory_request: "Parts",
  restock_auto: "Parts",
  claim_part_tamper: "Claims",
  warning_mistake_issued: "HR",
  tech_eod_reminder: "Tickets",
};

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const CATEGORY_FALLBACK = "General";

/**
 * Submodule slug -> department. Deliberately coarser than the module
 * registry itself: modules.ts nests HR/Accounting/CSR/Parts/Claims
 * dashboards all as sibling submodules under one "dashboard" module, and
 * splits Parts across two modules (dashboard + parts) — neither grouping
 * matches how staff actually think about "who does this belong to" (e.g.
 * a signed Wage Ack and a PTO request are both HR, even though one lives
 * under hr-dashboard and the other under attendance-monitoring). This map
 * is the source of truth for that department grouping; see categoryFor().
 */
const DEPARTMENT_BY_SUBMODULE: Record<string, string> = {
  // HR
  "hr-dashboard": "HR",
  "employee-self-service": "HR",
  "staff-list": "HR",
  "general-information": "HR",
  "report-hr-daily": "HR",
  // Attendance — its own dashboard tile in the app (separate from HR &
  // Recruitment), so notifications about it (time corrections, attendance
  // disputes) get their own bucket instead of piling into "HR" alongside
  // unrelated things like Jotform applicant submissions.
  "attendance-monitoring": "Attendance",
  "report-attendance-monitoring": "Attendance",
  // Accounting / Payroll
  "accounting-dashboard": "Accounting",
  "payroll-calculation": "Accounting",
  "expense-tracking": "Accounting",
  "report-accounting": "Accounting",
  // Parts
  "parts-dashboard": "Parts",
  "parts-order-dashboard": "Parts",
  "part-collection": "Parts",
  "part-footprint": "Parts",
  "part-history": "Parts",
  "part-inventory": "Parts",
  "part-management": "Parts",
  "part-order": "Parts",
  "part-pickup": "Parts",
  "part-receive": "Parts",
  "part-return": "Parts",
  "part-return-status": "Parts",
  "po-status": "Parts",
  "return-pickup": "Parts",
  "reserved-part-list": "Parts",
  "report-parts-daily": "Parts",
  // Claims
  "claims-dashboard": "Claims",
  "need-claim-list": "Claims",
  "claim-list": "Claims",
  "authorization-status": "Claims",
  "claim-calendar-weekly": "Claims",
  "claim-planner": "Claims",
  "claim-calendar-monthly": "Claims",
  "credit-card-report": "Claims",
  "encompass-claim-audit": "Claims",
  "monthly-part-report": "Claims",
  "payroll-report": "Claims",
  "unclaimed-parts-report": "Claims",
  "repair-code-restriction": "Claims",
  "sales-summary-report": "Claims",
  "tech-payroll-setup": "Claims",
  "payment-report": "Claims",
  "closing-report": "Claims",
  "repair-status-report": "Claims",
  "report-claims-daily": "Claims",
  // CSR
  "csr-dashboard": "CSR",
  "csr-team-leader-dashboard": "CSR",
  "csr-daily-report": "CSR",
  "csr-status-summary": "CSR",
  "call-tracker": "CSR",
  "live-chat-support": "CSR",
  "report-csr-daily": "CSR",
  // Tickets / Operations
  "ticket-list": "Tickets",
  "new-ticket": "Tickets",
  "sms-list": "Tickets",
  "todo-list": "Tickets",
  "work-planner": "Tickets",
  "work-calendar": "Tickets",
  "work-map": "Tickets",
  "daily-activity": "Tickets",
  "overall-status": "Tickets",
  "triage-dashboard": "Tickets",
  "report-triage-daily": "Tickets",
  "report-operations-daily": "Tickets",
  "technician-whereabouts": "Tickets",
  "flash-tech-calendar": "Tickets",
  // IT Support
  "it-tickets": "IT Support",
  // No "Admin" department — these submodules all live under modules.ts's
  // adminMod, so leaving them unmapped would fall through to that module's
  // own "Admin" label (see categoryFor()'s fallback chain) and recreate
  // the bucket anyway. Routed to CATEGORY_FALLBACK explicitly instead, per
  // the user's call that an Admin tab isn't needed.
  "user-management": CATEGORY_FALLBACK,
  "location-management": CATEGORY_FALLBACK,
  "add-branch": CATEGORY_FALLBACK,
  "account-management": CATEGORY_FALLBACK,
  "internal-message-support": CATEGORY_FALLBACK,
  "repair-statuses": CATEGORY_FALLBACK,
  "data-migration": CATEGORY_FALLBACK,
  "login-security": CATEGORY_FALLBACK,
  "accessibility-management": CATEGORY_FALLBACK,
  "company-settings": CATEGORY_FALLBACK,
  "universal-activity-log": CATEGORY_FALLBACK,
};

/**
 * A handful of submodules are shared by genuinely different departments,
 * distinguishable only by their `?tab=` value — most notably
 * employee-self-service, whose "payroll" tab ("your payslip is ready") is
 * Accounting, and whose "requests" tab (a shared "my requests" inbox for
 * PTO, Timecard Correction, and Attendance Dispute status pings — every
 * one of those is an Attendance topic, not a general-HR one) is Attendance
 * — even though hr-dashboard/employee-self-service's OTHER tabs default to
 * plain HR. (hr-dashboard's Jotform tab was tried as its own "Recruitment"
 * bucket too, but Jotform turns out to be a general intake channel for the
 * same document types the native forms system handles — Direct Deposit,
 * NDAs, Time Off, Subcontractor Agreements — not recruiting-specific, so
 * it's plain HR like the rest of hr-dashboard; no override needed for it.)
 * Checked BEFORE the plain submodule lookup below. Keyed as "$submodule:$tab".
 */
const DEPARTMENT_BY_SUBMODULE_TAB: Record<string, string> = {
  "employee-self-service:payroll": "Accounting",
  "employee-self-service:requests": "Attendance",
};

/**
 * Body-text overrides, checked BEFORE any link/kind-based rule in both
 * categoryFor() and subjectFor(). Exists because "who does this belong to"
 * sometimes has nothing to do with where the link happens to point:
 * Payroll Inquiry and Attendance Dispute both link to the exact same
 * attendance-monitoring "disputes-inquiries" tab (the app itself reviews
 * them in one shared tab), so the link can't tell them apart — only the
 * body can. Same for Accounting's mileage payroll-hold nudges, which deep-
 * link to the ticket for convenience but are payroll actions, not ticket-
 * dispatch ones. Order matters: first match wins, most specific first.
 */
const BODY_OVERRIDES: { test: RegExp; department: string; subject: string }[] = [
  { test: /payslip/i, department: "Accounting", subject: "Payslips" },
  { test: /payroll dispute/i, department: "Accounting", subject: "Payroll Disputes" },
  { test: /payroll inquiry/i, department: "Accounting", subject: "Payroll Inquiries" },
  { test: /on hold for payroll|hold from payroll/i, department: "Accounting", subject: "Mileage Holds" },
  { test: /payroll/i, department: "Accounting", subject: "Payroll" },
];

function bodyOverride(body?: string): { department: string; subject: string } | null {
  if (!body) return null;
  for (const rule of BODY_OVERRIDES) {
    if (rule.test.test(body)) return rule;
  }
  return null;
}

/**
 * Derives a department from a notification's link (and, for Firestore
 * items, its kind — see DEPARTMENT_BY_KIND above), so the Notification
 * Center can group by "who this belongs to" instead of showing one flat
 * feed. bodyOverride() is checked first (see its own comment); after that,
 * most links are "/m/$module/$submodule?..." — checked first against
 * DEPARTMENT_BY_SUBMODULE_TAB (for submodules whose tab, not just its
 * slug, decides who it really belongs to), then DEPARTMENT_BY_SUBMODULE —
 * that /m/ match wins outright when present, since it's the most specific
 * signal available. Failing that, `kind` is checked next: several
 * Firestore notifications click through to a generic page (e.g.
 * restock_auto links to a ticket detail page) that says nothing about the
 * notification's actual subject, so kind is a better signal there than
 * the link's own destination. A handful of remaining routes live outside
 * the /m/ registry (IT Support, ticket detail) and are special-cased
 * directly. Falls back to the module's own label, then "General", for
 * anything genuinely uncategorized.
 */
function categoryFor(linkTo: string | null, kind?: AppNotification["kind"], body?: string): string {
  const override = bodyOverride(body);
  if (override) return override.department;
  if (linkTo) {
    const [path, query] = linkTo.split("?");
    const moduleMatch = path.match(/^\/m\/([^/]+)\/([^/]+)/);
    if (moduleMatch) {
      const [, modSlug, subSlug] = moduleMatch;
      const tab = query ? new URLSearchParams(query).get("tab") : null;
      if (tab && DEPARTMENT_BY_SUBMODULE_TAB[`${subSlug}:${tab}`]) return DEPARTMENT_BY_SUBMODULE_TAB[`${subSlug}:${tab}`];
      if (DEPARTMENT_BY_SUBMODULE[subSlug]) return DEPARTMENT_BY_SUBMODULE[subSlug];
      const sub = getSubModule(modSlug, subSlug);
      if (sub) return sub.title;
      const mod = getModule(modSlug);
      if (mod) return mod.label;
    }
  }
  if (kind && DEPARTMENT_BY_KIND[kind]) return DEPARTMENT_BY_KIND[kind]!;
  if (!linkTo) return CATEGORY_FALLBACK;
  const path = linkTo.split("?")[0];
  if (path.includes("it-tickets")) return "IT Support";
  if (path.includes("/ticket/")) return "Tickets";
  return CATEGORY_FALLBACK;
}

/**
 * `$submodule:$tab` -> a specific subject label, finer than department.
 * Two submodules carry most of the app's notification traffic — hr-dashboard
 * and attendance-monitoring/employee-self-service — each with several tabs
 * whose notifications have nothing to do with each other (a Jotform
 * submission and a signed Wage Ack are both "HR", but a user scanning the
 * HR tab still wants them visually separated). Only entries whose tab
 * produces a genuinely ambiguous or unlabeled group are listed — anything
 * missing falls back through subjectFor()'s own chain below.
 */
const SUBJECT_BY_SUBMODULE_TAB: Record<string, string> = {
  "hr-dashboard:jotformDocuments": "Jotform Submissions",
  "hr-dashboard:coe": "Certificate of Employment",
  "hr-dashboard:warningForm": "Warning Forms",
  "hr-dashboard:promotionForm": "Promotion Forms",
  "hr-dashboard:actionPlanForm": "Manager's Action Plan",
  "hr-dashboard:terminationForm": "Termination Notices",
  "hr-dashboard:w8ben": "Tax Forms (W-8/W-9/W-4)",
  "hr-dashboard:i9": "Form I-9",
  "hr-dashboard:wageAck": "Acknowledgment of Wage",
  "hr-dashboard:carIqAgreement": "Car IQ Agreement",
  "hr-dashboard:vehicleAgreement": "Vehicle Use Agreement",
  "hr-dashboard:employeeConfidentiality": "Confidentiality Agreement",
  "hr-dashboard:mealRestBreak": "Meal & Rest Break",
  "hr-dashboard:ptoAck": "PTO Acknowledgment",
  "hr-dashboard:partsResponsibility": "Parts Responsibility",
  "hr-dashboard:mileageFuel": "Mileage & Fuel",
  "hr-dashboard:locationConsent": "Location Consent",
  "hr-dashboard:damage": "Damage Agreement",
  "hr-dashboard:contractorData": "Contractor Data",
  "hr-dashboard:directDeposit": "Direct Deposit",
  "attendance-monitoring:corrections": "Timecard Corrections",
  "attendance-monitoring:pto-management": "PTO & Sick Leave",
  "attendance-monitoring:disputes-inquiries": "Disputes & Inquiries",
  "employee-self-service:requests": "My Requests",
  "employee-self-service:payroll": "Payslips",
  "part-inventory:truck-stock-requests": "Truck Stock",
  "report-parts-daily:done-activity": "Parts Done Digest",
};

/** Firestore kind -> subject, for the same reason DEPARTMENT_BY_KIND exists — used only when no tab-based subject was found. */
const SUBJECT_BY_KIND: Partial<Record<AppNotification["kind"], string>> = {
  cross_inventory_request: "Cross-Branch Inventory",
  restock_auto: "Restock Alerts",
  part_status_change: "Part Status Changes",
  claim_part_tamper: "Claim / Tamper Reports",
  warning_mistake_issued: "Warnings & Mistakes",
  tech_eod_reminder: "End-of-Day Reminders",
};

const humanizeTab = (tab: string) =>
  tab.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Derives the finer within-department grouping shown as sub-headers in the
 * Notification Center (see NotificationCenterPage.tsx). Priority mirrors
 * categoryFor(): bodyOverride() first, then the submodule+tab pair (most
 * specific), then a titled submodule/module, then kind, then a humanized
 * tab as a last resort before "Other".
 */
function subjectFor(linkTo: string | null, kind?: AppNotification["kind"], body?: string): string {
  const override = bodyOverride(body);
  if (override) return override.subject;
  if (linkTo) {
    const [path, query] = linkTo.split("?");
    const moduleMatch = path.match(/^\/m\/([^/]+)\/([^/]+)/);
    if (moduleMatch) {
      const [, modSlug, subSlug] = moduleMatch;
      const tab = query ? new URLSearchParams(query).get("tab") : null;
      if (tab && SUBJECT_BY_SUBMODULE_TAB[`${subSlug}:${tab}`]) return SUBJECT_BY_SUBMODULE_TAB[`${subSlug}:${tab}`];
      if (kind && SUBJECT_BY_KIND[kind]) return SUBJECT_BY_KIND[kind]!;
      if (tab) return humanizeTab(tab);
      const sub = getSubModule(modSlug, subSlug);
      if (sub) return sub.title;
    }
  }
  if (kind && SUBJECT_BY_KIND[kind]) return SUBJECT_BY_KIND[kind]!;
  if (linkTo?.includes("it-tickets")) return "IT Tickets";
  if (linkTo?.includes("/ticket/")) return "Ticket Activity";
  return "Other";
}

/** DROPDOWN_LIMIT keeps the bell's preview list light; the Notification Center passes a much larger limit since it's meant to show everything, not a recent-N preview. */
const DROPDOWN_LIMIT = 30;

export function useMergedNotifications(options?: { limit?: number }) {
  const limit = options?.limit ?? DROPDOWN_LIMIT;
  const { uid, ready, role } = useAuth();
  // HR either as the primary role or as a sub-role (extra_roles) — useAuth()
  // only carries the primary role, so we resolve extra_roles separately.
  const [isHr, setIsHr] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [tableNotifs, setTableNotifs] = useState<NotificationRow[]>([]);
  const [firestoreNotifs, setFirestoreNotifs] = useState<AppNotification[]>([]);
  const seenFirestoreIds = useRef<Set<string> | null>(null);

  const load = useCallback(async (pid: string) => {
    try {
      setTableNotifs(await getMyNotifications(pid, limit));
    } catch (err) {
      console.error("Failed to load notifications:", err);
    }
  }, [limit]);

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    getMyProfileId(uid).then((pid) => {
      if (cancelled || !pid) return;
      setProfileId(pid);
      load(pid);
    });
    return () => { cancelled = true; };
  }, [ready, uid, load]);

  // Resolve HR status from primary role OR extra_roles (sub-roles) — a user
  // whose HR access comes from extra_roles wouldn't be caught by useAuth().role.
  useEffect(() => {
    if (!ready || !uid) {
      setIsHr(false);
      return;
    }
    if ((role ?? "").toUpperCase() === "HR") {
      setIsHr(true);
      return;
    }
    let cancelled = false;
    getMyRoles(uid).then(({ extraRoles }) => {
      if (!cancelled) setIsHr(extraRoles.some((r) => (r ?? "").toUpperCase() === "HR"));
    });
    return () => { cancelled = true; };
  }, [ready, uid, role]);

  // Live-append any new table-based notification addressed to me.
  useEffect(() => {
    if (!profileId) return;
    const unsubscribe = subscribeToMyNotifications(profileId, () => load(profileId));
    return unsubscribe;
  }, [profileId, load]);

  // HR only: realtime Firestore subscription (see file header). Re-subscribes
  // only when isHr or uid actually changes; the cleanup below always
  // unsubscribes the previous listener first, so there's never more than one
  // live listener for a given mount.
  useEffect(() => {
    if (!isHr || !uid) {
      setFirestoreNotifs([]);
      return;
    }
    seenFirestoreIds.current = null;
    const unsubscribe = subscribeNotifications(uid, (items) => {
      setFirestoreNotifs(items);
      if (seenFirestoreIds.current === null) {
        // First snapshot after (re)subscribing — establish the baseline
        // without chiming for notifications that already existed.
        seenFirestoreIds.current = new Set(items.map((i) => i.id));
      } else {
        const hasNewArrival = items.some((i) => !seenFirestoreIds.current!.has(i.id));
        seenFirestoreIds.current = new Set(items.map((i) => i.id));
        if (hasNewArrival) playNotifySound();
      }
    });
    return unsubscribe;
  }, [isHr, uid]);

  const notifs: MergedNotif[] = useMemo(() => {
    const merged: MergedNotif[] = [
      ...tableNotifs.map((n): MergedNotif => ({
        id: `tbl-${n.id}`,
        source: "table",
        senderName: n.senderName,
        body: n.body,
        createdAt: n.createdAt,
        isRead: n.isRead,
        starred: n.starred,
        linkTo: n.linkTo,
        category: categoryFor(n.linkTo, undefined, n.body),
        subject: subjectFor(n.linkTo, undefined, n.body),
      })),
      ...firestoreNotifs.map((n): MergedNotif => ({
        id: `fs-${n.id}`,
        source: "firestore",
        senderName: n.title,
        body: n.body,
        createdAt: n.createdAt,
        isRead: n.isRead,
        starred: Boolean(n.starred),
        linkTo: n.link ?? null,
        category: categoryFor(n.link ?? null, n.kind, n.body),
        subject: subjectFor(n.link ?? null, n.kind, n.body),
      })),
    ];
    return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tableNotifs, firestoreNotifs]);

  const unread = notifs.filter((n) => !n.isRead).length;

  const markRead = async (n: MergedNotif) => {
    if (n.isRead) return;
    if (n.source === "firestore") {
      if (!uid) return;
      const rawId = n.id.replace(/^fs-/, "");
      setFirestoreNotifs((prev) => prev.map((x) => (x.id === rawId ? { ...x, isRead: true } : x)));
      try {
        await markFirestoreNotificationRead(uid, rawId);
      } catch (err) {
        console.error("Failed to mark notification read:", err);
      }
      return;
    }
    const rawId = n.id.replace(/^tbl-/, "");
    setTableNotifs((prev) => prev.map((x) => (x.id === rawId ? { ...x, isRead: true } : x)));
    try {
      await markNotificationRead(rawId);
    } catch (err) {
      console.error("Failed to mark notification read:", err);
    }
  };

  /** The reverse of markRead — puts a notification back into the unread state (e.g. "I saw this but need to come back to it"), Gmail-style. */
  const markUnread = async (n: MergedNotif) => {
    if (!n.isRead) return;
    if (n.source === "firestore") {
      if (!uid) return;
      const rawId = n.id.replace(/^fs-/, "");
      setFirestoreNotifs((prev) => prev.map((x) => (x.id === rawId ? { ...x, isRead: false } : x)));
      try {
        await markFirestoreNotificationUnread(uid, rawId);
      } catch (err) {
        console.error("Failed to mark notification unread:", err);
      }
      return;
    }
    const rawId = n.id.replace(/^tbl-/, "");
    setTableNotifs((prev) => prev.map((x) => (x.id === rawId ? { ...x, isRead: false } : x)));
    try {
      await markNotificationUnread(rawId);
    } catch (err) {
      console.error("Failed to mark notification unread:", err);
    }
  };

  const markAll = async () => {
    setFirestoreNotifs((prev) => prev.map((x) => ({ ...x, isRead: true })));
    const firestoreMark = uid && firestoreNotifs.length > 0 ? markAllFirestoreNotificationsRead(uid) : Promise.resolve();
    if (!profileId) {
      try {
        await firestoreMark;
      } catch (err) {
        console.error("Failed to mark all notifications read:", err);
      }
      return;
    }
    setTableNotifs((prev) => prev.map((x) => ({ ...x, isRead: true })));
    try {
      await Promise.all([markAllNotificationsRead(profileId), firestoreMark]);
    } catch (err) {
      console.error("Failed to mark all notifications read:", err);
    }
  };

  /** Permanently removes one notification (e.g. clearing out test/junk entries) — optimistic local removal, then the matching backend delete. */
  const deleteOne = async (n: MergedNotif) => {
    if (n.source === "firestore") {
      if (!uid) return;
      const rawId = n.id.replace(/^fs-/, "");
      setFirestoreNotifs((prev) => prev.filter((x) => x.id !== rawId));
      try {
        await deleteFirestoreNotification(uid, rawId);
      } catch (err) {
        console.error("Failed to delete notification:", err);
      }
      return;
    }
    const rawId = n.id.replace(/^tbl-/, "");
    setTableNotifs((prev) => prev.filter((x) => x.id !== rawId));
    try {
      await deleteNotification(rawId);
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
  };

  /** Toggles the Gmail-style star — independent of read/unread, see MergedNotif.starred. */
  const toggleStar = async (n: MergedNotif) => {
    const next = !n.starred;
    if (n.source === "firestore") {
      if (!uid) return;
      const rawId = n.id.replace(/^fs-/, "");
      setFirestoreNotifs((prev) => prev.map((x) => (x.id === rawId ? { ...x, starred: next } : x)));
      try {
        await setFirestoreNotificationStarred(uid, rawId, next);
      } catch (err) {
        console.error("Failed to star notification:", err);
      }
      return;
    }
    const rawId = n.id.replace(/^tbl-/, "");
    setTableNotifs((prev) => prev.map((x) => (x.id === rawId ? { ...x, starred: next } : x)));
    try {
      await setNotificationStarred(rawId, next);
    } catch (err) {
      console.error("Failed to star notification:", err);
    }
  };

  return { notifs, unread, markRead, markUnread, markAll, deleteOne, toggleStar };
}
