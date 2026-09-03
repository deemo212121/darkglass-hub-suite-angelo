import { createFileRoute, Link, Navigate, notFound, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MapProviderToggle } from "@/components/MapProviderToggle";
import { useAuth } from "@/lib/auth";
import { getModule, DASHBOARD_GRID_EXCLUDED_SLUGS, type ModuleDef, type SubModuleDef } from "@/lib/modules";
import { hasDashboardAccess } from "@/lib/dashboardAccess";
import { getModuleRoleGate } from "@/lib/moduleAccess";
import { isModuleAllowed, isModuleAllowedForTrainee } from "@/lib/roleLabels";
import { canAccessSubmodule } from "@/lib/submoduleAccess";
import { getMyRoles, getCompanyUsers } from "@/lib/supabase/users";
import {
  getCompanyMapProvider,
  setCompanyMapProvider,
  getCompanyDefaultTechnician,
  setCompanyDefaultTechnician,
  type MapProvider,
} from "@/lib/supabase/companySettings";
import { getLocations, upsertLocation, type LocationRow } from "@/lib/supabase/locationManagement";
import { getPendingDoneItems, clearPendingDoneItems, PARTS_DONE_QUEUE_EVENT, type PendingDoneItem } from "@/lib/partsDoneQueue";
import { notifyPartsManagers } from "@/lib/partsNotify";
import { groupBranchesByManager } from "@/lib/supabase/partsManagerBranches";
import { getBranchProgress, formatBranchProgressLine, type BranchProgress } from "@/lib/partsBranchProgress";
import { getEffectiveNotificationRoles } from "@/lib/supabase/notificationRoleGates";
import { filterOptedIn } from "@/lib/supabase/notificationOptOuts";
import { sendNotification } from "@/lib/firebase/notifications";
import { logPartsDoneActivity } from "@/lib/supabase/partsDoneActivityLog";
import { ArrowRight, ChevronLeft, ChevronDown, ChevronUp, CheckCheck } from "lucide-react";

// Sentinel <select> value for "force this branch unassigned regardless of
// the company-wide default" — distinct from "" (no override, inherit the
// company default), which no real technician name will ever collide with.
const FORCE_UNASSIGNED = "__FORCE_UNASSIGNED__";

// Deep link for the "Parts done" notification — lands on Report > Part
// Daily Report's Done Activity tab (see ReportPartsDaily.tsx's own
// ?tab=done-activity handling), not just the module's Overview.
const PARTS_DONE_DIGEST_LINK = "/m/report/report-parts-daily?tab=done-activity";

// A handful of Claims/Report tiles carry a leading "(A)"/"(R)" marker (e.g.
// "(A) Closing Report") — stripped here for sort purposes only (still shown
// on the tile itself) so those land alphabetically among the rest by their
// actual name instead of clumping together at the front of every grid.
function submoduleSortKey(title: string): string {
  return title.replace(/^\([A-Z]\)\s*/, "");
}

export const Route = createFileRoute("/m/$module")({
  head: ({ params }) => ({
    meta: [{ title: `${getModule(params.module)?.label ?? "Module"} — Admin Hub Solutions` }],
  }),
  loader: async ({ params }) => {
    const m = getModule(params.module);
    if (!m) throw notFound();
    return { module: m };
  },
  component: ModuleIndex,
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="panel text-center max-w-md">
        <h1 className="text-xl font-semibold">Unknown module</h1>
        <Link to="/home" className="btn btn-primary mt-4 inline-flex">Back home</Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="panel text-center max-w-md">
        <h1 className="text-xl font-semibold">Couldn't load module</h1>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </div>
    </div>
  ),
});

function ModuleIndex() {
  const { ready, email, role, uid, companyId, displayName, isTrainee } = useAuth();
  // Route.useLoaderData()'s type resolves to `undefined` for this route in
  // the current @tanstack/react-router version — a known inference gap for
  // parent routes with children, not a real runtime issue (the loader
  // always returns { module } or throws notFound() first).
  const { module: m } = Route.useLoaderData() as { module: ModuleDef };
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  const isAdmin = [role, ...extraRoles].some((r) => ["ADMIN", "SUPERADMIN"].includes((r || "").toUpperCase()));

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
  const [imDoneMessage, setImDoneMessage] = useState<string | null>(null);
  const [branchProgress, setBranchProgress] = useState<BranchProgress[]>([]);
  const [branchProgressLoading, setBranchProgressLoading] = useState(false);
  useEffect(() => {
    if (m.slug !== "parts") return;
    const refresh = () => setPendingDoneItems(getPendingDoneItems());
    refresh();
    window.addEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [m.slug]);

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

  const openImDoneModal = () => {
    if (pendingDoneItems.length === 0) return;
    setImDoneModalOpen(true);
    setBranchProgressLoading(true);
    getBranchProgress(pendingBranches)
      .then(setBranchProgress)
      .catch((err) => console.error("Failed to load branch progress:", err))
      .finally(() => setBranchProgressLoading(false));
  };

  const confirmImDone = async () => {
    if (pendingDoneItems.length === 0) return;
    setImDoneSending(true);
    setImDoneMessage(null);
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
      setImDoneMessage(`Notified Parts Manager${byManager.size === 1 && unassignedBranches.length === 0 ? "" : "s"} for ${pendingBranches.length} branch${pendingBranches.length === 1 ? "" : "es"}.`);
      window.setTimeout(() => setImDoneMessage(null), 4000);
    } catch (err) {
      console.error("Failed to notify Parts Manager:", err);
      setImDoneMessage("Failed to send notification — please try again.");
    } finally {
      setImDoneSending(false);
    }
  };

  // Company-wide map provider (see migration 0050) — every map-bearing page
  // in the system (Ticket Map, Work Planner, Work Map, Location Management
  // coverage, Add Branch, the mobile tech route view) reads this same
  // setting, so changing it here changes all of them at once.
  const [mapProvider, setMapProvider] = useState<MapProvider | null>(null);
  const [savingMapProvider, setSavingMapProvider] = useState(false);

  useEffect(() => {
    if (!ready || !email || m.slug !== "admin") return;
    let cancelled = false;
    getCompanyMapProvider().then((p) => { if (!cancelled) setMapProvider(p); });
    return () => { cancelled = true; };
  }, [ready, email, m.slug]);

  const handleMapProviderChange = async (next: MapProvider) => {
    if (next === mapProvider || savingMapProvider) return;
    setSavingMapProvider(true);
    try {
      await setCompanyMapProvider(next);
      setMapProvider(next);
    } catch (err) {
      alert(`Failed to change map provider: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingMapProvider(false);
    }
  };

  // Company-wide default technician (see migration 0067) — every new ticket
  // is created with this technician instead of starting unassigned.
  const [defaultTechnician, setDefaultTechnicianState] = useState("");
  const [technicianRoster, setTechnicianRoster] = useState<string[]>([]);

  useEffect(() => {
    if (!ready || !email || m.slug !== "admin") return;
    let cancelled = false;
    getCompanyDefaultTechnician().then((t) => { if (!cancelled) setDefaultTechnicianState(t); });
    getCompanyUsers().then((users) => {
      if (cancelled) return;
      const names = users
        .filter((u) => {
          const roles = [u.role, ...(u.extra_roles ?? [])].map((r) => (r || "").toUpperCase());
          return u.is_active && (roles.includes("TECHNICIAN") || roles.includes("TECHNICIAN_MANAGER"));
        })
        .map((u) => u.display_name || u.email)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setTechnicianRoster(names);
    }).catch((err) => console.error("Failed to load technician roster:", err));
    return () => { cancelled = true; };
  }, [ready, email, m.slug]);

  // Per-branch default technician: same "Rep Tech" field Location
  // Management already edits (location_mgmt_locations.rep_tech) - editing
  // it here updates the exact same row, just from the Admin page instead
  // of digging through the full Location Management table.
  const [locations, setLocations] = useState<LocationRow[]>([]);

  useEffect(() => {
    if (!ready || !email || m.slug !== "admin") return;
    let cancelled = false;
    getLocations().then((rows) => { if (!cancelled) setLocations(rows); })
      .catch((err) => console.error("Failed to load locations:", err));
    return () => { cancelled = true; };
  }, [ready, email, m.slug]);

  // Dropdowns in this panel only stage a change locally — nothing is
  // written until "Save Changes" is clicked, so scrolling/clicking through
  // ~30 branches can't accidentally commit a change. pendingDefaultTechnician
  // is null when there's no staged edit; pendingLocationChanges maps
  // location id -> staged <select> value (specific tech / "" / FORCE_UNASSIGNED).
  const [pendingDefaultTechnician, setPendingDefaultTechnician] = useState<string | null>(null);
  const [pendingLocationChanges, setPendingLocationChanges] = useState<Map<string, string>>(new Map());
  const [savingChanges, setSavingChanges] = useState(false);
  // Collapsed by default so the per-branch list (30+ rows) doesn't push the
  // rest of the Admin page's content down out of view.
  const [branchListExpanded, setBranchListExpanded] = useState(false);
  const hasPendingChanges = pendingDefaultTechnician !== null || pendingLocationChanges.size > 0;

  const handleDefaultTechnicianChange = (next: string) => {
    setPendingDefaultTechnician(next === defaultTechnician ? null : next);
  };

  const handleRepTechChange = (loc: LocationRow, next: string) => {
    const savedValue = loc.forceUnassigned ? FORCE_UNASSIGNED : (loc.repTech || "");
    setPendingLocationChanges((current) => {
      const updated = new Map(current);
      if (next === savedValue) updated.delete(loc.id);
      else updated.set(loc.id, next);
      return updated;
    });
  };

  const handleDiscardChanges = () => {
    setPendingDefaultTechnician(null);
    setPendingLocationChanges(new Map());
  };

  const handleSaveChanges = async () => {
    setSavingChanges(true);
    const errors: string[] = [];

    if (pendingDefaultTechnician !== null) {
      try {
        await setCompanyDefaultTechnician(pendingDefaultTechnician);
        setDefaultTechnicianState(pendingDefaultTechnician);
        setPendingDefaultTechnician(null);
      } catch (err) {
        errors.push(`Company default: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    for (const [locId, value] of pendingLocationChanges) {
      const loc = locations.find((l) => l.id === locId);
      if (!loc) continue;
      try {
        const saved = await upsertLocation({
          ...loc,
          repTech: value === FORCE_UNASSIGNED ? "" : value,
          forceUnassigned: value === FORCE_UNASSIGNED,
        });
        setLocations((current) => current.map((l) => (l.id === locId ? saved : l)));
        setPendingLocationChanges((current) => {
          const updated = new Map(current);
          updated.delete(locId);
          return updated;
        });
      } catch (err) {
        errors.push(`${loc.location}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    setSavingChanges(false);
    if (errors.length > 0) {
      alert(`Some changes failed to save:\n\n${errors.join("\n")}`);
    }
  };

  // Previously only fetched for the Dashboard module, on the assumption
  // that only Dashboard's own submodule gate (getDashboardRoleGate) needed
  // a secondary role. That stopped being true once canAccessSubmodule's
  // fuller gate (admin-module/user-management/activity-log/company-
  // settings, used by the tile-grid filters below) started checking
  // extraRoles too: on every OTHER module this stayed the initial `[]`
  // forever, so a user whose ADMIN access came only from a secondary role
  // (extra_roles) would see the Admin module's own tiles disappear even
  // though they could still open it directly via URL. isAdmin above (used
  // elsewhere in this file, e.g. Parts' admin-only controls) had the same
  // gap for the same reason.
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    getMyRoles(uid).then(({ extraRoles }) => { if (!cancelled) setExtraRoles(extraRoles); });
    return () => { cancelled = true; };
  }, [ready, uid]);

  if (!ready) return null;
  if (!email) return <Navigate to="/landing" replace />;

  const hasChildRoute = typeof window !== "undefined" && window.location.pathname.split("/").filter(Boolean).length > 2;

  if (hasChildRoute) {
    // Render the child route (submodule detail page)
    return <Outlet />;
  }

  // A whole-module CSR block (e.g. Parts, Claims) still yields if an admin
  // explicitly granted this role one of the module's submodules via
  // Accessibility Management's Module Access by Role grid — otherwise
  // that override could never actually be reached, since the tile grid
  // page itself would refuse to render before the per-submodule filtering
  // below even runs.
  const hasSubmoduleOverrideForRole = m.submodules.some((s: SubModuleDef) => {
    const allowed = getModuleRoleGate(m.slug, s.slug);
    return allowed && hasDashboardAccess(allowed, role, extraRoles);
  });

  if (!isModuleAllowed(role, m.slug, extraRoles) && !hasSubmoduleOverrideForRole) {
    return (
      <>
        <AppHeader />
        <main className="max-w-[1400px] mx-auto px-6 py-8 page-fade-in">
          <div className="panel text-center max-w-md mx-auto">
            <h1 className="text-xl font-semibold">Access restricted</h1>
            <p className="text-sm text-muted-foreground mt-2">Your role doesn't have access to the {m.label} module.</p>
            <Link to="/home" className="btn btn-primary mt-4 inline-flex">Back home</Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  // Trainees only see Employee Self-Service — checked independently of the
  // role gate above (it doesn't depend on role, and isn't lifted by a
  // Module Access override, unlike the CSR block above). Dashboard itself
  // still renders here so the per-submodule filter further down can show
  // just that one tile; every other module is blocked outright.
  if (!isModuleAllowedForTrainee(isTrainee, m.slug)) {
    return (
      <>
        <AppHeader />
        <main className="max-w-[1400px] mx-auto px-6 py-8 page-fade-in">
          <div className="panel text-center max-w-md mx-auto">
            <h1 className="text-xl font-semibold">Access restricted</h1>
            <p className="text-sm text-muted-foreground mt-2">You're currently marked as a Trainee — only the Employee Self-Service dashboard is available until this changes.</p>
            <Link to="/home" className="btn btn-primary mt-4 inline-flex">Back home</Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const partsLandingOrder = [
    "part-pickup",
    "part-collection",
    "part-return-status",
    "part-receive",
    "part-inventory",
    "part-history",
    "part-footprint",
    "part-return",
    "part-management",
    "part-order",
    "po-status",
    "return-pickup",
  ];

  const ticketsLandingOrder = [
    "ticket-list",
    "ticket-details",
    "sms-list",
    "followup",
    "new-ticket",
    "todo-list",
    "work-planner",
    "work-calendar",
    "work-map",
    "report-tar",
  ];

  const reportsLandingOrder = [
    "daily-activity-report",
    "csr-daily-work",
    "first-time-fix-report",
    "part-transaction-report",
    "long-time-period-report",
    "turnaround-time-report",
    "report-tech",
    "tech-daily-report",
    "tech-efficiency-report",
    "tech-performance-report",
    "model-documents",
    "tech-work-overview",
  ];

  const submodules = (
    m.slug === "parts" || m.slug === "tickets" || m.slug === "report"
      ? [...m.submodules].sort((left, right) => {
          const order = m.slug === "parts" ? partsLandingOrder : m.slug === "tickets" ? ticketsLandingOrder : reportsLandingOrder;
          const leftIndex = order.indexOf(left.slug);
          const rightIndex = order.indexOf(right.slug);
          return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
        })
      : m.submodules
  ).filter((s: SubModuleDef) => !s.hiddenFromGrid);

  return (
    <>
      <AppHeader />
      <main className="max-w-[1400px] mx-auto px-6 py-8 page-fade-in">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <Link to="/home" className="btn"><ChevronLeft className="h-4 w-4" />Home</Link>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
                {m.label}
              </h1>
              <p className="text-sm text-muted-foreground">{m.tagline}</p>
            </div>
          </div>
          {m.slug === "parts" && (
            <div className="flex items-center gap-2">
              {imDoneMessage && <span className="text-sm text-green-400">{imDoneMessage}</span>}
              <button
                type="button"
                onClick={openImDoneModal}
                disabled={pendingDoneItems.length === 0 || imDoneSending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 inline-flex items-center gap-2"
                title="Notify Parts Manager with everything marked done on Part Receive / Daily Collection / Daily Pickup"
              >
                <CheckCheck className="h-4 w-4" />
                {imDoneSending ? "Sending…" : `Done${pendingDoneItems.length > 0 ? ` (${pendingDoneItems.length})` : ""}`}
              </button>
            </div>
          )}
        </div>
        {m.slug === "admin" && isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5 items-stretch">
        {mapProvider && (
          <div className="panel flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Map Provider</h3>
              <p className="text-xs text-muted-foreground">
                Controls every map in the system (Ticket Map, Work Planner, Work Map, Location
                Management coverage, Add Branch, and the mobile tech route view) at once.
              </p>
            </div>
            <MapProviderToggle value={mapProvider} onChange={handleMapProviderChange} disabled={savingMapProvider} />
          </div>
        )}
          <div className="panel">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Default Technician</h3>
                <p className="text-xs text-muted-foreground">
                  New tickets start assigned to a technician instead of unassigned.
                  Set one company-wide, then optionally override per branch.
                  Nothing saves until you click Save Changes.
                </p>
              </div>
              {hasPendingChanges && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleDiscardChanges}
                    disabled={savingChanges}
                    className="btn"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveChanges}
                    disabled={savingChanges}
                    className="btn btn-primary"
                  >
                    {savingChanges ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <tbody>
                  <tr className={`border-b border-white/10 ${pendingDefaultTechnician !== null ? "bg-amber-500/10" : "bg-white/5"}`}>
                    <td className="px-3 py-2 font-semibold">All Branches (Company Default)</td>
                    <td className="px-3 py-2 text-right">
                      <select
                        className="glass-input"
                        value={pendingDefaultTechnician ?? defaultTechnician}
                        disabled={savingChanges}
                        onChange={(e) => handleDefaultTechnicianChange(e.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {technicianRoster.map((tech) => (
                          <option key={tech} value={tech}>{tech}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
              <button
                type="button"
                onClick={() => setBranchListExpanded((v) => !v)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground border-b border-white/10 transition-colors"
              >
                {branchListExpanded ? (
                  <>Hide per-branch overrides <ChevronUp className="h-3.5 w-3.5" /></>
                ) : (
                  <>Show all {locations.length} branches <ChevronDown className="h-3.5 w-3.5" /></>
                )}
              </button>
              {branchListExpanded && (
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {locations.map((loc) => {
                        const savedValue = loc.forceUnassigned ? FORCE_UNASSIGNED : (loc.repTech || "");
                        const pendingValue = pendingLocationChanges.get(loc.id);
                        const isPending = pendingValue !== undefined;
                        return (
                          <tr key={loc.id} className={`border-b border-white/5 last:border-0 ${isPending ? "bg-amber-500/10" : ""}`}>
                            <td className="px-3 py-2">{loc.location}</td>
                            <td className="px-3 py-2 text-right">
                              <select
                                className="glass-input"
                                value={pendingValue ?? savedValue}
                                disabled={savingChanges}
                                onChange={(e) => handleRepTechChange(loc, e.target.value)}
                              >
                                <option value="">Use Company Default</option>
                                <option value={FORCE_UNASSIGNED}>Force Unassigned</option>
                                {technicianRoster.map((tech) => (
                                  <option key={tech} value={tech}>{tech}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
        {m.slug === "dashboard" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {submodules
              .filter((s: SubModuleDef) => !DASHBOARD_GRID_EXCLUDED_SLUGS.has(s.slug))
              // Full gate (see submoduleAccess.ts) — the same check the
              // submodule route itself enforces, so a restricted tile is
              // never shown here only to land on "Access restricted" once
              // clicked.
              .filter((s: SubModuleDef) => canAccessSubmodule(role, extraRoles, m.slug, s, isTrainee))
              // Alphabetical, same as every other module's grid below.
              .sort((a: SubModuleDef, b: SubModuleDef) => submoduleSortKey(a.title).localeCompare(submoduleSortKey(b.title)))
              .map((s: SubModuleDef) => (
              <Link
                key={s.slug}
                to="/m/$module/$submodule"
                params={{ module: m.slug, submodule: s.slug }}
                className="module-card group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold">{s.title}</h3>
                  <ArrowRight className="ml-auto h-4 w-4 opacity-60 group-hover:translate-x-1 transition" />
                </div>
                <p className="text-sm text-muted-foreground">{s.description}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {submodules
              // Full gate (see submoduleAccess.ts) — the same check the
              // submodule route itself enforces.
              .filter((s: SubModuleDef) => canAccessSubmodule(role, extraRoles, m.slug, s, isTrainee))
              .sort((a: SubModuleDef, b: SubModuleDef) => submoduleSortKey(a.title).localeCompare(submoduleSortKey(b.title)))
              .map((s: SubModuleDef) => (
              <Link
                key={s.slug}
                to="/m/$module/$submodule"
                params={{ module: m.slug, submodule: s.slug }}
                className="module-card group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold">{s.title}</h3>
                  <ArrowRight className="ml-auto h-4 w-4 opacity-60 group-hover:translate-x-1 transition" />
                </div>
                <p className="text-sm text-muted-foreground">{s.description}</p>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
      {imDoneModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !imDoneSending && setImDoneModalOpen(false)}>
          <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Notify Parts Manager?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {pendingDoneItems.length} item{pendingDoneItems.length === 1 ? "" : "s"} marked done, across {pendingBranches.length} branch{pendingBranches.length === 1 ? "" : "es"}.
            </p>
            <div className="overflow-y-auto flex-1 -mx-2 px-2 space-y-3 mb-4">
              {pendingBranches.map((branch) => {
                const progress = branchProgress.find((p) => p.branch === branch);
                const bySource = pendingByBranch.get(branch);
                return (
                  <div key={branch} className="rounded border border-white/10 bg-white/5 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-semibold text-white">{branch} Parts:</span>
                      <span className="text-xs text-muted-foreground" title="Who's reporting this update">{displayName || email || "Unknown"}</span>
                    </div>
                    {branchProgressLoading || !progress ? (
                      <p className="text-xs text-muted-foreground">Loading progress…</p>
                    ) : (
                      <ul className="space-y-0.5 mb-2">
                        <li className="text-sm text-slate-200">Collections done {progress.collectionsDone}/{progress.collectionsTotal}</li>
                        <li className="text-sm text-slate-200">Daily Pickup done {progress.pickupDone}/{progress.pickupTotal}</li>
                        <li className="text-sm text-slate-200">Parts Received done {progress.receivedDone}/{progress.receivedTotal}</li>
                      </ul>
                    )}
                    {bySource && (
                      <div className="text-xs text-muted-foreground space-y-0.5 border-t border-white/10 pt-1.5 mt-1.5">
                        {Array.from(bySource.entries()).map(([source, labels]) => (
                          <div key={source}>{source}: {labels.join(", ")}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImDoneModalOpen(false)}
                disabled={imDoneSending}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmImDone}
                disabled={imDoneSending || branchProgressLoading}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {imDoneSending ? "Sending…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
