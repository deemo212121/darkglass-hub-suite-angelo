/**
 * Home → "Today": a greeting with the date, then a compact "Needs your
 * attention" strip — one card per thing waiting on this person, each
 * linking to the page that handles it.
 *
 *  - Team managers: what's assigned to THEM to approve in the normal
 *    process — leave / sick leave and time corrections at the Manager step,
 *    and ticket time disputes. Same rules as Attendance Monitoring's own
 *    Approve buttons (canReviewPtoStage / canReviewCorrectionStage /
 *    canReviewTicketDispute, Approval Chain registered first), so the
 *    counts match what they'll find there.
 *  - HR / Admin / Super Admin / Finance: the company-wide pending PTO and
 *    time corrections they work from the HR side, plus anyone over the
 *    monthly correction limit (Admin / HR / Super Admin).
 *  - Everyone: unread notifications and messages; Parts roles also get
 *    "Parts updated — click DONE".
 *
 * Counts are also handed back up (onCounts) so the module cards can badge
 * the same pages.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, CalendarClock, CheckCheck, ClipboardEdit, Flag, HeartPulse, MessageCircle, PartyPopper, TicketCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { canAccessSubmodule } from "@/lib/submoduleAccess";
import { getModule } from "@/lib/modules";
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
import { getPendingDoneItems, PARTS_DONE_QUEUE_EVENT } from "@/lib/partsDoneQueue";
import { MAX_CORRECTIONS_PER_MONTH } from "@/components/ExceededTimeCorrectionsTab";
import { OPEN_MESSENGER_EVENT } from "@/components/FloatingMessenger";

/** Pending counts keyed "module/submodule", for badges on the module cards. */
export type PageCounts = Record<string, number>;

/** These roles work approvals from the HR side, not as a team manager. */
const COMPANY_WIDE_ROLES = new Set(["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN", "HR", "FINANCE"]);
const LIMIT_ROLES = new Set(["ADMIN", "HR", "SUPERADMIN"]);
const PARTS_ROLES = new Set(["PARTS", "PARTS_TEAM_LEADER", "PARTS_MANAGER", "PARTS_ORDER"]);

function localISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

type Tone = "warn" | "alert" | "info";

interface AttentionItem {
  key: string;
  count: number;
  label: string;
  icon: ReactNode;
  tone: Tone;
  title?: string;
  to?: [string, string] | [string];
  href?: string;
  onClick?: () => void;
}

/** The requester's current manager and that manager's own manager, by name — the fallbacks the review rules take. */
function managerChain(profiles: ProfileRow[], requesterId: string): [string | null, string | null] {
  const managerName = profiles.find((p) => p.id === requesterId)?.manager_name ?? null;
  const managersManager = managerName
    ? profiles.find((p) => (p.display_name || "").trim().toLowerCase() === managerName.trim().toLowerCase())?.manager_name ?? null
    : null;
  return [managerName, managersManager];
}

export function HomeToday({ onCounts }: { onCounts?: (c: PageCounts) => void }) {
  const { uid, displayName, email, role, extraRoles, isTrainee, isFrozen } = useAuth();
  const extra = extraRoles ?? [];
  const firstName = (displayName || email || "").split(/[\s@]/)[0];
  const heldRoles = [role, ...extra].filter(Boolean).map((r) => normalizeRole(r as string));
  const isCompanyWide = heldRoles.some((r) => COMPANY_WIDE_ROLES.has(r));
  const isTeamManager = !isCompanyWide && isAttendanceManagerTierRole(role, extra);
  const isParts = heldRoles.some((r) => PARTS_ROLES.has(r));

  const firstPage = (candidates: [string, string][]): [string, string] | null => {
    for (const [mod, sub] of candidates) {
      const s = getModule(mod)?.submodules.find((x) => x.slug === sub);
      if (s && canAccessSubmodule(role, extra, mod, s, isTrainee, isFrozen)) return [mod, sub];
    }
    return null;
  };

  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [partsDone, setPartsDone] = useState(() => getPendingDoneItems().length);

  useEffect(() => {
    const refresh = () => setPartsDone(getPendingDoneItems().length);
    window.addEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
    return () => window.removeEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
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
    const wantsPto = isTeamManager || (isCompanyWide && !!absentPage);
    const wantsCorrections = isTeamManager || canSeeLimit || (isCompanyWide && !!approvalsPage);

    (async () => {
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
      if (cancelled) return;

      const next: AttentionItem[] = [];
      const counts: PageCounts = {};
      const bump = (page: [string, string] | null, n: number) => {
        if (page && n > 0) counts[page.join("/")] = (counts[page.join("/")] ?? 0) + n;
      };

      if (isTeamManager) {
        // Only what's assigned to this manager to approve.
        const managerStep = (requesterId: string, kind: "pto" | "correction", req: any) => {
          const [mgr, mgrsMgr] = managerChain(profiles, requesterId);
          return kind === "pto"
            ? canReviewPtoStage(req, "manager", myId, role, extra, displayName, mgr, mgrsMgr)
            : canReviewCorrectionStage(req, "manager", myId, role, extra, displayName, mgr, mgrsMgr);
        };
        const leaveWaiting = pto.filter(
          (r) => r.profileId !== myId && r.status === "pending" && r.managerStatus === "pending" && managerStep(r.profileId, "pto", r)
        );
        const sick = leaveWaiting.filter((r) => r.ptoType === "sick").length;
        const leave = leaveWaiting.length - sick;
        const fixes = corrections.filter(
          (c) => c.profileId !== myId && c.status === "pending" && c.managerStatus === "pending" && managerStep(c.profileId, "correction", c)
        ).length;
        const disputes = requests.filter(
          (r) =>
            r.profileId !== myId &&
            r.requestType === "ticket_time_dispute" &&
            r.status === "pending" &&
            canReviewTicketDispute(r.profileId, role, extra, displayName, profiles)
        ).length;
        const title = "Approve in Attendance Monitoring";
        const to = approvalsPage ?? undefined;
        if (leave > 0) next.push({ key: "pto", count: leave, label: leave === 1 ? "PTO / leave request" : "PTO / leave requests", icon: <CalendarClock />, tone: "warn", title, to });
        if (sick > 0) next.push({ key: "sick", count: sick, label: sick === 1 ? "Sick leave request" : "Sick leave requests", icon: <HeartPulse />, tone: "warn", title, to });
        if (fixes > 0) next.push({ key: "corrections", count: fixes, label: fixes === 1 ? "Time correction" : "Time corrections", icon: <ClipboardEdit />, tone: "warn", title, to });
        if (disputes > 0) next.push({ key: "disputes", count: disputes, label: disputes === 1 ? "Ticket time dispute" : "Ticket time disputes", icon: <TicketCheck />, tone: "warn", title, to });
        bump(approvalsPage, leave + sick + fixes + disputes);
      } else if (isCompanyWide) {
        const pendingPto = pto.filter((r) => r.status === "pending").length;
        if (absentPage && pendingPto > 0) {
          bump(absentPage, pendingPto);
          next.push({ key: "pto", count: pendingPto, label: pendingPto === 1 ? "PTO request pending" : "PTO requests pending", icon: <CalendarClock />, tone: "warn", title: "Employee Monitoring → PTO Management", to: absentPage });
        }
        const pendingFixes = corrections.filter((c) => c.status === "pending").length;
        if (approvalsPage && pendingFixes > 0) {
          bump(approvalsPage, pendingFixes);
          next.push({ key: "corrections", count: pendingFixes, label: pendingFixes === 1 ? "Time correction to review" : "Time corrections to review", icon: <ClipboardEdit />, tone: "warn", title: "Attendance Monitoring", to: approvalsPage });
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
        if (over > 0)
          next.push({
            key: "over-limit",
            count: over,
            label: over === 1 ? "Person over the correction limit" : "People over the correction limit",
            icon: <Flag />,
            tone: "alert",
            title: `More than ${MAX_CORRECTIONS_PER_MONTH} corrections this month — Exceeded → Time Corrections`,
            to: absentPage,
          });
      }

      const unreadNotifications = notifications.filter((n) => !n.isRead).length;
      if (unreadNotifications > 0)
        next.push({ key: "notifications", count: unreadNotifications, label: unreadNotifications === 1 ? "Unread notification" : "Unread notifications", icon: <Bell />, tone: "info", href: "/notifications" });
      if (unread.total > 0)
        next.push({
          key: "messages",
          count: unread.total,
          label: unread.total === 1 ? "Unread message" : "Unread messages",
          icon: <MessageCircle />,
          tone: "info",
          onClick: () => window.dispatchEvent(new Event(OPEN_MESSENGER_EVENT)),
        });

      setItems(next);
      onCounts?.(counts);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, role, extra.join(","), displayName, isTrainee, isFrozen]);

  // Parts "Done" lives in this browser (partsDoneQueue), so it updates live.
  const allItems: AttentionItem[] | null = items
    ? [
        ...(isParts && partsDone > 0
          ? [{ key: "parts-done", count: partsDone, label: partsDone === 1 ? "Part updated — click DONE" : "Parts updated — click DONE", icon: <CheckCheck />, tone: "alert" as const, to: ["parts"] as [string] }]
          : []),
        ...items,
      ]
    : null;
  const total = allItems?.length ?? 0;

  const renderItem = (it: AttentionItem) => {
    const body = (
      <>
        <span className="home-attn-icon">{it.icon}</span>
        <span className="home-attn-count">{it.count > 99 ? "99+" : it.count}</span>
        <span className="home-attn-label">{it.label}</span>
      </>
    );
    const cls = `home-attn home-attn--${it.tone}`;
    if (it.onClick)
      return (
        <button key={it.key} type="button" onClick={it.onClick} className={cls} title={it.title}>
          {body}
        </button>
      );
    if (it.href)
      return (
        <a key={it.key} href={it.href} className={cls} title={it.title}>
          {body}
        </a>
      );
    if (it.to?.length === 2)
      return (
        <Link key={it.key} to="/m/$module/$submodule" params={{ module: it.to[0], submodule: it.to[1] }} className={cls} title={it.title}>
          {body}
        </Link>
      );
    if (it.to)
      return (
        <Link key={it.key} to="/m/$module" params={{ module: it.to[0] }} className={cls} title={it.title}>
          {body}
        </Link>
      );
    return (
      <div key={it.key} className={cls} title={it.title}>
        {body}
      </div>
    );
  };

  return (
    <section className="home-today" aria-label="Today">
      <p className="home-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
      <h1 className="home-title">
        {greeting()}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="home-sub">
        {allItems === null
          ? "Checking what needs you today…"
          : total === 0
            ? "Nothing is waiting on you right now."
            : `${total} ${total === 1 ? "thing needs" : "things need"} your attention.`}
      </p>
      <div className="home-attn-grid">
        {allItems === null ? (
          [0, 1, 2].map((i) => <div key={i} className="home-attn home-attn--skeleton ui-skeleton" />)
        ) : allItems.length === 0 ? (
          <div className="home-attn home-attn--clear">
            <span className="home-attn-icon">
              <PartyPopper />
            </span>
            <span className="home-attn-label">You're all caught up</span>
          </div>
        ) : (
          allItems.map(renderItem)
        )}
      </div>
    </section>
  );
}
