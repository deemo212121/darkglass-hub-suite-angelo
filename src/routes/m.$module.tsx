import { createFileRoute, Link, Navigate, notFound, Outlet } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { getModule, type SubModuleDef } from "@/lib/modules";
import { ArrowRight, ChevronLeft } from "lucide-react";

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
  const { ready, email, role } = useAuth();
  const { module: m } = Route.useLoaderData();

  if (!ready) return null;
  if (!email) return <Navigate to="/landing" replace />;

  const hasChildRoute = typeof window !== "undefined" && window.location.pathname.split("/").filter(Boolean).length > 2;

  if (hasChildRoute) {
    // Render the child route (submodule detail page)
    return <Outlet />;
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
        {m.slug === "dashboard" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {submodules
              .filter((s: SubModuleDef) => !["csr-daily-report", "call-tracker", "csr-status-summary"].includes(s.slug))
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
            {submodules.map((s: SubModuleDef) => (
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
