import { createFileRoute, Link, Navigate, notFound, Outlet, useMatchRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { getModule, type SubModuleDef } from "@/lib/modules";
import { ArrowRight, BarChart3, ChevronLeft, ClipboardList, ChartColumnIncreasing } from "lucide-react";

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
  const { ready, email } = useAuth();
  const { module: m } = Route.useLoaderData();
  const matchRoute = useMatchRoute();
  
  if (!ready) return null;
  if (!email) return <Navigate to="/landing" />;
  
  // Check if a child route is currently matched (has a submodule)
  const hasChildRoute = matchRoute({ to: "/m/$module/$submodule" });
  
  if (hasChildRoute) {
    // Render the child route (submodule detail page)
    return <Outlet />;
  }
  
  // Render the module index (navigation cards)
  const dashboardIcons: Record<string, typeof BarChart3> = {
    "overall-status": BarChart3,
    "repair-forecast": ChartColumnIncreasing,
    "daily-activity": ClipboardList,
  };

  const dashboardCardStyles: Record<string, string> = {
    "overall-status": "bg-white text-slate-900 border border-slate-200 shadow-[0_14px_34px_rgba(15,23,42,0.14)] hover:-translate-y-1 hover:border-blue-500/40 hover:shadow-[0_18px_42px_rgba(37,99,235,0.18)]",
    "repair-forecast": "bg-[rgba(255,255,255,0.08)] text-white border border-[rgba(255,255,255,0.15)] backdrop-blur-md hover:-translate-y-1 hover:bg-[rgba(255,255,255,0.12)] hover:border-[rgba(91,126,255,0.5)]",
    "daily-activity": "bg-[rgba(255,255,255,0.08)] text-white border border-[rgba(255,255,255,0.15)] backdrop-blur-md hover:-translate-y-1 hover:bg-[rgba(255,255,255,0.12)] hover:border-[rgba(91,126,255,0.5)]",
  };

  const dashboardCardIconStyles: Record<string, string> = {
    "overall-status": "bg-blue-50 text-blue-700 border border-blue-100 shadow-none",
    "repair-forecast": "bg-white/10 text-white border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.18)]",
    "daily-activity": "bg-white/10 text-white border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.18)]",
  };

  const dashboardCardMetaStyles: Record<string, string> = {
    "overall-status": "text-slate-500",
    "repair-forecast": "text-white/45",
    "daily-activity": "text-white/45",
  };

  const partsLandingOrder = [
    "part-collection",
    "part-footprint",
    "part-history",
    "part-inventory",
    "part-management",
    "part-order",
    "part-pickup",
    "part-receive",
    "part-return",
    "part-return-status",
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
          <div className="grid gap-5 lg:grid-cols-3">
            {submodules.map((s: SubModuleDef, index) => {
              const Icon = dashboardIcons[s.slug] ?? ArrowRight;
              const cardStyle = dashboardCardStyles[s.slug] ?? dashboardCardStyles["repair-forecast"];
              const iconStyle = dashboardCardIconStyles[s.slug] ?? dashboardCardIconStyles["repair-forecast"];
              const metaStyle = dashboardCardMetaStyles[s.slug] ?? dashboardCardMetaStyles["repair-forecast"];
              return (
                <Link
                  key={s.slug}
                  to="/m/$module/$submodule"
                  params={{ module: m.slug, submodule: s.slug }}
                  className={`group rounded-[18px] p-6 transition-all duration-200 ${cardStyle}`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${iconStyle}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-3">
                        <h3 className={`text-sm font-semibold uppercase tracking-[0.18em] ${s.slug === "overall-status" ? "text-slate-900" : "text-white/95"}`}>
                          {s.title}
                        </h3>
                        <ArrowRight className={`ml-auto h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-1 ${s.slug === "overall-status" ? "text-slate-700" : "text-white"}`} />
                      </div>
                      <p className={`mt-3 text-sm leading-6 ${s.slug === "overall-status" ? "text-slate-600" : "text-white/75"}`}>
                        {s.description}
                      </p>
                      <p className={`mt-5 text-[0.72rem] font-medium uppercase tracking-[0.18em] ${metaStyle}`}>
                        Open submenu {index + 1}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
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
