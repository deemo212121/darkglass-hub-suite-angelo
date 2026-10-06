/**
 * Parts "Done" button — everything marked done on Part Receive, Part Daily
 * Pickup and Part Daily Collection (src/lib/partsDoneQueue.ts), sent as one
 * per-branch progress digest to each branch's Parts Manager. Shown on the
 * Parts hub and on those three pages; they all share the same queue, so
 * sending from any of them clears it everywhere.
 */
import { useEffect, useRef, useState } from "react";
import { AppModal } from "@/components/ui-kit/AppModal";
import { toast } from "sonner";
import { useBlocker } from "@tanstack/react-router";
import { CheckCheck, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getPendingDoneItems, clearPendingDoneItems, PARTS_DONE_QUEUE_EVENT, type PendingDoneItem } from "@/lib/partsDoneQueue";
import { notifyPartsManagers } from "@/lib/partsNotify";
import { groupBranchesByManager } from "@/lib/supabase/partsManagerBranches";
import { getBranchProgress, formatBranchProgressLine, type BranchProgress } from "@/lib/partsBranchProgress";
import { getEffectiveNotificationRoles } from "@/lib/supabase/notificationRoleGates";
import { filterOptedIn } from "@/lib/supabase/notificationOptOuts";
import { sendNotification } from "@/lib/firebase/notifications";
import { logPartsDoneActivity } from "@/lib/supabase/partsDoneActivityLog";

const PARTS_DONE_DIGEST_LINK = "/m/report/report-parts-daily?tab=done-activity";

/** The banner's "Send now" asks the page's Done button to open its box. */
export const OPEN_PARTS_DONE_EVENT = "ahs:open-parts-done";

/** Pages that have the Done button — moving between them never warns. */
const DONE_PAGES = /^\/m\/parts(\/(part-receive|part-pickup|part-collection))?\/?$/;

export function PartsDoneButton() {
  const { email, companyId, displayName } = useAuth();
  // Parts hub's single "Done" button — aggregates rows marked done across
  // Part Receive / Part Daily Collection / Part Daily Pickup (see
  // src/lib/partsDoneQueue.ts), grouped by BRANCH, into one progress
  // digest per branch ("Asheville Parts: Collections done 4/10, ...").
  // Each branch's Parts Manager (profiles.branch_access — see
  // partsManagerBranches.ts) only gets notified about their own
  // branch(es), not the whole company's activity.
  const [pendingDoneItems, setPendingDoneItems] = useState<PendingDoneItem[]>([]);
  const [imDoneModalOpen, setImDoneModalOpen] = useState(false);
  const [imDoneSending, setImDoneSending] = useState(false);
  const [branchProgress, setBranchProgress] = useState<BranchProgress[]>([]);
  const [branchProgressLoading, setBranchProgressLoading] = useState(false);
  useEffect(() => {
    const refresh = () => setPendingDoneItems(getPendingDoneItems());
    refresh();
    window.addEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Unsent items + leaving the Parts Done pages → warn. Closing / reloading the tab
  // gets the browser's own "Leave site?" box (its wording can't be changed).
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => getPendingDoneItems().length > 0 && !DONE_PAGES.test(next.pathname),
    enableBeforeUnload: () => getPendingDoneItems().length > 0,
    withResolver: true,
  });

  const pendingBranches = Array.from(new Set(pendingDoneItems.map((i) => i.branch).filter(Boolean))).sort();
  // branch -> source -> labels, for the "marked this session" sub-list
  // shown under each branch's progress line in the preview.
  const pendingByBranch = new Map<string, Map<string, string[]>>();
  for (const item of pendingDoneItems) {
    const branch = item.branch || "(no branch)";
    const bySource = pendingByBranch.get(branch) ?? new Map<string, string[]>();
    const labels = bySource.get(item.source) ?? [];
    labels.push(item.label);
    bySource.set(item.source, labels);
    pendingByBranch.set(branch, bySource);
  }

  // "Send now" on the yellow banner (PartsDoneBanner) opens this box (always the latest version of it).
  const openImDoneModalRef = useRef<() => void>(() => {});
  useEffect(() => {
    const open = () => openImDoneModalRef.current();
    window.addEventListener(OPEN_PARTS_DONE_EVENT, open);
    return () => window.removeEventListener(OPEN_PARTS_DONE_EVENT, open);
  }, []);

  const openImDoneModal = () => {
    if (pendingDoneItems.length === 0) return;
    setImDoneModalOpen(true);
    setBranchProgressLoading(true);
    getBranchProgress(pendingBranches)
      .then(setBranchProgress)
      .catch((err) => console.error("Failed to load branch progress:", err))
      .finally(() => setBranchProgressLoading(false));
  };

  openImDoneModalRef.current = openImDoneModal;

  const confirmImDone = async () => {
    if (pendingDoneItems.length === 0) return;
    setImDoneSending(true);
    try {
      const notifyRoles = await getEffectiveNotificationRoles("parts_done_digest");
      const { byManager, unassignedBranches } = await groupBranchesByManager(pendingBranches, notifyRoles);
      const actor = displayName || email || "A team member";
      const lineFor = (branch: string) => {
        const progress = branchProgress.find((p) => p.branch === branch);
        return progress ? formatBranchProgressLine(progress) : `${branch} Parts: progress unavailable`;
      };

      // Per-user opt-outs (Accessibility Management > Notification Access
      // by Role's "opt out" grid) layer on top of the role-based routing
      // above — a manager whose role qualifies can still have personally
      // opted out of this specific trigger.
      const managerUids = await filterOptedIn(Array.from(byManager.keys()), "parts_done_digest");
      const optedInManagers = new Set(managerUids);

      // One activity-log row per BRANCH per Done click, not per manager
      // notified — a branch can have more than one Parts Manager covering
      // it (e.g. someone with all-branch access), and logging per-manager
      // made the Done Activity tab show several duplicate-looking rows for
      // the same branch. branchRecipientCounts tallies how many people
      // actually got notified for each branch, folded into that one row.
      const branchRecipientCounts = new Map<string, number>();
      const sends: Promise<void>[] = [];
      for (const [uid, branches] of byManager) {
        if (!optedInManagers.has(uid)) continue;
        const body = `${actor} update — ${branches.map(lineFor).join(" • ")}`;
        sends.push(sendNotification([uid], { kind: "part_status_change", title: "Parts done", body, link: PARTS_DONE_DIGEST_LINK }));
        for (const branch of branches) {
          branchRecipientCounts.set(branch, (branchRecipientCounts.get(branch) ?? 0) + 1);
        }
      }
      if (unassignedBranches.length > 0) {
        const body = `${actor} update (no assigned Parts Manager found for these branches) — ${unassignedBranches.map(lineFor).join(" • ")}`;
        sends.push((async () => {
          const recipientCount = await notifyPartsManagers(companyId, notifyRoles, "parts_done_digest", { kind: "part_status_change", title: "Parts done", body, link: PARTS_DONE_DIGEST_LINK });
          for (const branch of unassignedBranches) branchRecipientCounts.set(branch, recipientCount);
        })());
      }
      await Promise.all(sends);
      await Promise.all(
        pendingBranches.map((branch) => {
          const progress = branchProgress.find((p) => p.branch === branch);
          return logPartsDoneActivity({
            branch,
            summary: lineFor(branch),
            recipientCount: branchRecipientCounts.get(branch) ?? 0,
            actorName: actor,
            metrics: progress
              ? {
                  collectionsDone: progress.collectionsDone,
                  collectionsTotal: progress.collectionsTotal,
                  pickupDone: progress.pickupDone,
                  pickupTotal: progress.pickupTotal,
                  receivedDone: progress.receivedDone,
                  receivedTotal: progress.receivedTotal,
                }
              : undefined,
          });
        })
      );

      clearPendingDoneItems();
      setPendingDoneItems([]);
      setImDoneModalOpen(false);
      toast.success(`Notified Parts Manager${byManager.size === 1 && unassignedBranches.length === 0 ? "" : "s"} for ${pendingBranches.length} branch${pendingBranches.length === 1 ? "" : "es"}.`);
    } catch (err) {
      console.error("Failed to notify Parts Manager:", err);
      toast.error("Couldn't notify the Parts Manager — check your connection and click Done again.");
    } finally {
      setImDoneSending(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openImDoneModal}
          disabled={pendingDoneItems.length === 0 || imDoneSending}
          className="btn btn-primary"
          title="Notify Parts Manager with everything marked done on Part Receive / Daily Collection / Daily Pickup"
        >
          <CheckCheck />
          {imDoneSending ? "Sending…" : `Done${pendingDoneItems.length > 0 ? ` (${pendingDoneItems.length})` : ""}`}
        </button>
      </div>

      {blocker.status === "blocked" && (
        <AppModal
          tone="warning"
          size="sm"
          icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
          title="You haven't clicked DONE yet"
          onClose={() => blocker.reset()}
          footer={
            <>
              <button type="button" onClick={() => blocker.reset()} className="btn">
                Stay
              </button>
              <button type="button" onClick={() => blocker.proceed()} className="btn">
                Leave anyway
              </button>
              <button
                type="button"
                onClick={() => {
                  blocker.reset();
                  openImDoneModal();
                }}
                className="btn btn-primary"
              >
                <CheckCheck /> DONE
              </button>
            </>
          }
        >
          <p className="text-sm">
            <strong>
              {pendingDoneItems.length} part{pendingDoneItems.length === 1 ? "" : "s"} updated
            </strong>{" "}
            ({pendingDoneItems.slice(0, 3).map((i) => i.label).join(", ")}
            {pendingDoneItems.length > 3 ? `, +${pendingDoneItems.length - 3} more` : ""}). Please click DONE to complete this action.
          </p>
        </AppModal>
      )}

      {imDoneModalOpen && (
        <AppModal
          title="Notify Parts Manager?"
          description={`${pendingDoneItems.length} item${pendingDoneItems.length === 1 ? "" : "s"} marked done, across ${pendingBranches.length} branch${pendingBranches.length === 1 ? "" : "es"}.`}
          busy={imDoneSending}
          onClose={() => setImDoneModalOpen(false)}
          footer={
            <>
              <button type="button" onClick={() => setImDoneModalOpen(false)} disabled={imDoneSending} className="btn">
                Cancel
              </button>
              <button type="button" onClick={confirmImDone} disabled={imDoneSending || branchProgressLoading} className="btn btn-primary">
                {imDoneSending ? "Sending…" : "Confirm"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            {pendingBranches.map((branch) => {
              const progress = branchProgress.find((p) => p.branch === branch);
              const bySource = pendingByBranch.get(branch);
              return (
                <div key={branch} className="rounded-lg border border-[var(--color-panel-border)] bg-[color-mix(in_oklab,var(--color-foreground)_4%,transparent)] px-3 py-2">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-sm font-semibold">{branch} Parts</span>
                    <span className="text-xs text-muted-foreground" title="Who's reporting this update">{displayName || email || "Unknown"}</span>
                  </div>
                  {branchProgressLoading || !progress ? (
                    <p className="text-xs text-muted-foreground">Loading progress…</p>
                  ) : (
                    <ul className="space-y-0.5 mb-2 text-sm tabular-nums">
                      <li>Collections done {progress.collectionsDone}/{progress.collectionsTotal}</li>
                      <li>Daily Pickup done {progress.pickupDone}/{progress.pickupTotal}</li>
                      <li>Parts Received done {progress.receivedDone}/{progress.receivedTotal}</li>
                    </ul>
                  )}
                  {bySource && (
                    <div className="text-xs text-muted-foreground space-y-0.5 border-t border-[var(--color-panel-border)] pt-1.5 mt-1.5">
                      {Array.from(bySource.entries()).map(([source, labels]) => (
                        <div key={source}>
                          {source}: {labels.join(", ")}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </AppModal>
      )}
    </>
  );
}
