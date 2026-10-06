/**
 * "Needs your attention" — what's waiting on the signed-in person, computed
 * once and shared by every place that shows it: Home's attention strip, the
 * red badges on module and page cards, the breadcrumb strip above pages,
 * and tab badges inside pages (e.g. Attendance Monitoring's PTO / Corrections
 * / Ticket Dispute tabs).
 *
 *  - Team managers: what's assigned to THEM to approve — leave / sick leave
 *    and time corrections at the Manager step, and ticket time disputes.
 *    Same rules as Attendance Monitoring's own Approve buttons
 *    (canReviewPtoStage / canReviewCorrectionStage / canReviewTicketDispute,
 *    Approval Chain registered first), so the counts match what they find.
 *  - HR / Admin / Super Admin / Finance: company-wide pending PTO and time
 *    corrections, plus anyone over the monthly correction limit
 *    (Admin / HR / Super Admin).
 *  - Everyone: unread notifications and messages.
 *
 * Cached for a minute per person so moving between pages doesn't refetch.
 * Parts "click DONE" lives in this browser (partsDoneQueue) and is added by
 * the strip itself so it updates live.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { canAccessSubmodule } from "@/lib/submoduleAccess";
import { isAttendanceManagerTierRole, normalizeRole } from "@/lib/roleLabels";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getProfileIdByFirebaseUid } from "@/lib/supabase/timecards";
import { registerApprovalDirectory } from "@/lib/approvalDirectory";
import { getCompanyPtoRequests, canReviewPtoStage } from "@/lib/supabase/pto";
import { getCompanyTimecardCorrections, canReviewCorrectionStage } from "@/lib/supabase/timecardCorrections";
import { getCompanyEmployeeRequests, canReviewTicketDispute } from "@/lib/supabase/employeeRequests";
import { getCorrectionExemptions } from "@/lib/supabase/correctionExemptions";
import { getMyNotifications } from "@/lib/supabase/notifications";
import { getUnreadCounts } from "@/lib/supabase/messaging";

/** Corrections allowed per person per month (Exceeded → Time Corrections). */
export const MAX_CORRECTIONS_PER_MONTH = 2;

export type AttentionKind = "pto" | "sick" | "corrections" | "disputes" | "over-limit" | "notifications" | "messages";
export type AttentionTone = "warn" | "alert" | "info";

export interface AttentionItem {
  kind: AttentionKind;
  count: number;
  label: string;
  tone: AttentionTone;
  title?: string;
  /** Page to open: [module, submodule]. */
  to?: [string, string];
  href?: string;
  /** The messenger opens instead of navigating. */
  opensMessenger?: boolean;
}

export interface Attention {
  items: AttentionItem[];
  /** "module/submodule" → pending count, for card and breadcrumb badges. */
  pageCounts: Record<string, number>;
  /** "page:tab" → pending count, for tab badges inside a page (e.g. "attendance-monitoring:corrections", "absent-list:ptoManagement"). */
  tabCounts: Record<string, number>;
}

const COMPANY_WIDE_ROLES = new Set(["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN", "HR", "FINANCE"]);
const LIMIT_ROLES = new Set(["ADMIN", "HR", "SUPERADMIN"]);
const CACHE_MS = 60_000;

let cache: { key: string; at: number; data: Attention } | null = null;
let inflight: { key: string; promise: Promise<Attention> } | null = null;
const listeners = new Set<(a: Attention) => void>();

function localISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The requester's current manager and that manager's own manager, by name — the fallbacks the review rules take. */
function managerChain(profiles: ProfileRow[], requesterId: string): [string | null, string | null] {
  const managerName = profiles.find((p) => p.id === requesterId)?.manager_name ?? null;
  const managersManager = managerName
    ? profiles.find((p) => (p.display_name || "").trim().toLowerCase() === managerName.trim().toLowerCase())?.manager_name ?? null
    : null;
  return [managerName, managersManager];
}

interface Who {
  uid: string;
  role: string | null;
  extraRoles: string[];
  displayName: string | null;
  isTrainee: boolean;
  isFrozen: boolean;
}

async function compute(who: Who): Promise<Attention> {
  const { uid, role, extraRoles: extra, displayName, isTrainee, isFrozen } = who;
  // Loaded here, not as a top-level import: modules.ts is its own build chunk
  // and imports from src/lib, so a static import from this src/lib file made
  // the two chunks import each other and crashed the Worker at startup
  // ("Cannot access ALL_TECHNICIANS before initialization").
  const { getModule } = await import("@/lib/modules");
  const heldRoles = [role, ...extra].filter(Boolean).map((r) => normalizeRole(r as string));
  const isCompanyWide = heldRoles.some((r) => COMPANY_WIDE_ROLES.has(r));
  const isTeamManager = !isCompanyWide && isAttendanceManagerTierRole(role, extra);
  const firstPage = (candidates: [string, string][]): [string, string] | null => {
    for (const [mod, sub] of candidates) {
      const s = getModule(mod)?.submodules.find((x) => x.slug === sub);
      if (s && canAccessSubmodule(role, extra, mod, s, isTrainee, isFrozen)) return [mod, sub];
    }
    return null;
  };
  const approvalsPage = firstPage([
    ["dashboard", "attendance-monitoring"],
    ["accounting", "attendance-monitoring"],
    ["hr", "attendance-monitoring"],
  ]);
  const absentPage = firstPage([
    ["hr", "absent-list"],
    ["accounting", "absent-list"],
  ]);
  const canSeeLimit = !!absentPage && heldRoles.some((r) => LIMIT_ROLES.has(r));
  const wantsPto = isTeamManager || (isCompanyWide && (!!absentPage || !!approvalsPage));
  const wantsCorrections = isTeamManager || canSeeLimit || (isCompanyWide && !!approvalsPage);

  const myId = await getProfileIdByFirebaseUid(uid).catch(() => null);
  const [profiles, pto, corrections, requests, exemptions, notifications, unread] = await Promise.all([
    isTeamManager ? getCompanyUsers().catch(() => [] as ProfileRow[]) : Promise.resolve([] as ProfileRow[]),
    wantsPto ? getCompanyPtoRequests().catch(() => []) : Promise.resolve([]),
    wantsCorrections ? getCompanyTimecardCorrections().catch(() => []) : Promise.resolve([]),
    isTeamManager ? getCompanyEmployeeRequests().catch(() => []) : Promise.resolve([]),
    canSeeLimit ? getCorrectionExemptions().catch(() => []) : Promise.resolve([]),
    myId ? getMyNotifications(myId, 50).catch(() => []) : Promise.resolve([]),
    myId ? getUnreadCounts(myId).catch(() => ({ total: 0 })) : Promise.resolve({ total: 0 }),
  ]);
  if (isTeamManager) await registerApprovalDirectory(profiles).catch(() => undefined);

  const items: AttentionItem[] = [];
  const pageCounts: Record<string, number> = {};
  const tabCounts: Record<string, number> = {};
  const bump = (page: [string, string] | null, n: number) => {
    if (page && n > 0) pageCounts[page.join("/")] = (pageCounts[page.join("/")] ?? 0) + n;
  };
  const tab = (key: string, n: number) => {
    if (n > 0) tabCounts[`attendance-monitoring:${key}`] = (tabCounts[`attendance-monitoring:${key}`] ?? 0) + n;
  };

  if (isTeamManager) {
    const managerStep = (requesterId: string, kind: "pto" | "correction", req: any) => {
      const [mgr, mgrsMgr] = managerChain(profiles, requesterId);
      return kind === "pto"
        ? canReviewPtoStage(req, "manager", myId, role, extra, displayName, mgr, mgrsMgr)
        : canReviewCorrectionStage(req, "manager", myId, role, extra, displayName, mgr, mgrsMgr);
    };
    const leaveWaiting = pto.filter((r) => r.profileId !== myId && r.status === "pending" && r.managerStatus === "pending" && managerStep(r.profileId, "pto", r));
    const sick = leaveWaiting.filter((r) => r.ptoType === "sick").length;
    const leave = leaveWaiting.length - sick;
    const fixes = corrections.filter((c) => c.profileId !== myId && c.status === "pending" && c.managerStatus === "pending" && managerStep(c.profileId, "correction", c)).length;
    const disputes = requests.filter(
      (r) => r.profileId !== myId && r.requestType === "ticket_time_dispute" && r.status === "pending" && canReviewTicketDispute(r.profileId, role, extra, displayName, profiles)
    ).length;
    const title = "Approve in Attendance Monitoring";
    const to = approvalsPage ?? undefined;
    if (leave > 0) items.push({ kind: "pto", count: leave, label: leave === 1 ? "PTO / leave request" : "PTO / leave requests", tone: "warn", title, to });
    if (sick > 0) items.push({ kind: "sick", count: sick, label: sick === 1 ? "Sick leave request" : "Sick leave requests", tone: "warn", title, to });
    if (fixes > 0) items.push({ kind: "corrections", count: fixes, label: fixes === 1 ? "Time correction" : "Time corrections", tone: "warn", title, to });
    if (disputes > 0) items.push({ kind: "disputes", count: disputes, label: disputes === 1 ? "Ticket time dispute" : "Ticket time disputes", tone: "warn", title, to });
    bump(approvalsPage, leave + sick + fixes + disputes);
    tab("pto-management", leave + sick);
    tab("corrections", fixes);
    tab("ticket-dispute", disputes);
  } else if (isCompanyWide) {
    const pendingPto = pto.filter((r) => r.status === "pending").length;
    if (absentPage && pendingPto > 0) {
      bump(absentPage, pendingPto);
      items.push({ kind: "pto", count: pendingPto, label: pendingPto === 1 ? "PTO request pending" : "PTO requests pending", tone: "warn", title: "Employee Monitoring → PTO Management", to: absentPage });
    }
    if (approvalsPage) tab("pto-management", pendingPto);
    if (absentPage && pendingPto > 0) tabCounts["absent-list:ptoManagement"] = pendingPto;
    const pendingFixes = corrections.filter((c) => c.status === "pending").length;
    if (approvalsPage && pendingFixes > 0) {
      bump(approvalsPage, pendingFixes);
      tab("corrections", pendingFixes);
      items.push({ kind: "corrections", count: pendingFixes, label: pendingFixes === 1 ? "Time correction to review" : "Time corrections to review", tone: "warn", title: "Attendance Monitoring", to: approvalsPage });
    }
  }

  if (canSeeLimit && absentPage) {
    const month = localISO().slice(0, 7);
    const exempt = new Set(exemptions.filter((e) => !e.removedAt).map((e) => e.correctionId));
    const perPerson = new Map<string, number>();
    for (const c of corrections) {
      if (!c.workDate.startsWith(month) || c.status === "rejected" || exempt.has(c.id)) continue;
      perPerson.set(c.profileId, (perPerson.get(c.profileId) ?? 0) + 1);
    }
    const over = Array.from(perPerson.values()).filter((n) => n > MAX_CORRECTIONS_PER_MONTH).length;
    if (over > 0) {
      tabCounts["absent-list:exceeded"] = over;
      tabCounts["absent-list:timeCorrections"] = over;
    }
    if (over > 0)
      items.push({
        kind: "over-limit",
        count: over,
        label: over === 1 ? "Person over the correction limit" : "People over the correction limit",
        tone: "alert",
        title: `More than ${MAX_CORRECTIONS_PER_MONTH} corrections this month — Exceeded → Time Corrections`,
        to: absentPage,
      });
  }

  const unreadNotifications = notifications.filter((n) => !n.isRead).length;
  if (unreadNotifications > 0)
    items.push({ kind: "notifications", count: unreadNotifications, label: unreadNotifications === 1 ? "Unread notification" : "Unread notifications", tone: "info", href: "/notifications" });
  if (unread.total > 0)
    items.push({ kind: "messages", count: unread.total, label: unread.total === 1 ? "Unread message" : "Unread messages", tone: "info", opensMessenger: true });

  return { items, pageCounts, tabCounts };
}

/** What's waiting on the signed-in person — null while loading. Shared and cached across the app. */
export function useAttention(): Attention | null {
  const { uid, role, extraRoles, displayName, isTrainee, isFrozen } = useAuth();
  const extra = extraRoles ?? [];
  const key = [uid, role, extra.join(","), displayName, isTrainee, isFrozen].join("|");
  const [data, setData] = useState<Attention | null>(() => (cache && cache.key === key ? cache.data : null));

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    const listener = (a: Attention) => alive && setData(a);
    listeners.add(listener);
    if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) {
      setData(cache.data);
    } else {
      if (!inflight || inflight.key !== key) {
        const promise = compute({ uid, role, extraRoles: extra, displayName, isTrainee, isFrozen }).then((d) => {
          cache = { key, at: Date.now(), data: d };
          if (inflight?.promise === promise) inflight = null;
          listeners.forEach((l) => l(d));
          return d;
        });
        promise.catch(() => {
          if (inflight?.promise === promise) inflight = null;
        });
        inflight = { key, promise };
      }
    }
    return () => {
      alive = false;
      listeners.delete(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return data;
}

/** Red count badge text — "99+" past 99. */
export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}
