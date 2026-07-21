import { createFileRoute, Link, Navigate, notFound, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MapProviderToggle } from "@/components/MapProviderToggle";
import { useAuth } from "@/lib/auth";
import { getModule, type SubModuleDef } from "@/lib/modules";
import { getDashboardRoleGate, hasDashboardAccess } from "@/lib/dashboardAccess";
import { isModuleAllowed, isSubmoduleAllowed } from "@/lib/roleLabels";
import { getMyRoles, getCompanyUsers } from "@/lib/supabase/users";
import {
  getCompanyMapProvider,
  setCompanyMapProvider,
  getCompanyDefaultTechnician,
  setCompanyDefaultTechnician,
  type MapProvider,
} from "@/lib/supabase/companySettings";
import { getLocations, upsertLocation, type LocationRow } from "@/lib/supabase/locationManagement";
import { ArrowRight, ChevronLeft, ChevronDown, ChevronUp } from "lucide-react";

// Sentinel <select> value for "force this branch unassigned regardless of
// the company-wide default" — distinct from "" (no override, inherit the
// company default), which no real technician name will ever collide with.
const FORCE_UNASSIGNED = "__FORCE_UNASSIGNED__";

export const Route = createFileRoute("/m/$module")({
  head: ({ params }) => ({
    meta: [{ title: `${getModule(params.module)?.label ?? "Module"} — Admin Hub Solutions` }],
  }),
  loader: ({ params }) => {
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
  const { ready, email, role, uid } = useAuth();
  const { module: m } = Route.useLoaderData();
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  const isAdmin = ["ADMIN", "SUPERADMIN"].includes((role || "").toUpperCase());

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

  useEffect(() => {
    if (!ready || !uid || m.slug !== "dashboard") return;
    let cancelled = false;
    getMyRoles(uid).then(({ extraRoles }) => { if (!cancelled) setExtraRoles(extraRoles); });
    return () => { cancelled = true; };
  }, [ready, uid, m.slug]);

  if (!ready) return null;
  if (!email) return <Navigate to="/landing" replace />;

  const hasChildRoute = typeof window !== "undefined" && window.location.pathname.split("/").filter(Boolean).length > 2;

  if (hasChildRoute) {
    // Render the child route (submodule detail page)
    return <Outlet />;
  }

  if (!isModuleAllowed(role, m.slug)) {
    return (
      <>
        <AppHeader />
        <main className="max-w-[1400px] mx-auto px-6 py-8">
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

  const submodules =
    m.slug === "parts" || m.slug === "tickets" || m.slug === "report"
      ? [...m.submodules].sort((left, right) => {
          const order = m.slug === "parts" ? partsLandingOrder : m.slug === "tickets" ? ticketsLandingOrder : reportsLandingOrder;
          const leftIndex = order.indexOf(left.slug);
          const rightIndex = order.indexOf(right.slug);
          return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
        })
      : m.submodules;

  return (
    <>
      <AppHeader />
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-5">
          <Link to="/home" className="btn"><ChevronLeft className="h-4 w-4" />Home</Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              {m.label}
            </h1>
            <p className="text-sm text-muted-foreground">{m.tagline}</p>
          </div>
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
              .filter((s: SubModuleDef) => !["csr-daily-report", "call-tracker", "csr-status-summary", "csr-team-leader-dashboard"].includes(s.slug))
              .filter((s: SubModuleDef) => {
                const allowed = getDashboardRoleGate(s.slug);
                return !allowed || hasDashboardAccess(allowed, role, extraRoles);
              })
              .filter((s: SubModuleDef) => isSubmoduleAllowed(role, m.slug, s.slug))
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
              .filter((s: SubModuleDef) => isSubmoduleAllowed(role, m.slug, s.slug))
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
    </>
  );
}
