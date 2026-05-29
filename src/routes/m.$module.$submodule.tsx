import { createFileRoute, Link, Navigate, Outlet, notFound, useLocation } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { OverallStatusPage } from "@/components/OverallStatusPage";
import { RepairForecastPage } from "@/components/RepairForecastPage";
import { DailyActivityPage } from "@/components/DailyActivityPage";
import { useAuth } from "@/lib/auth";
import { getModule, getSubModule } from "@/lib/modules";
import { GenericModulePage } from "@/components/GenericModulePage";
import { PartReturnStatusPage } from "@/components/PartReturnStatus";
import { ClaimsPipeline } from "@/components/ClaimsPipeline";
import { NeedClaimList } from "@/components/NeedClaimList";
import { ClaimList } from "@/components/ClaimList";
import { AuthorizationStatus } from "@/components/AuthorizationStatus";
import { ClaimCalendarMonthly } from "@/components/ClaimCalendarMonthly";
import { ClaimCalendarWeekly } from "@/components/ClaimCalendarWeekly";
import { ClaimPlanner } from "@/components/ClaimPlanner";
import { CreditCardReport } from "@/components/CreditCardReport";
import { FtfReport } from "@/components/FtfReport";
import { LtpReport } from "@/components/LtpReport";
import { TatReport } from "@/components/TatReport";
import { CsrDailyWork } from "@/components/CsrDailyWork";
import { DailyActivityReport } from "@/components/DailyActivityReport";
import { InternalMessageReport } from "@/components/InternalMessageReport";
import { LoginStatistics } from "@/components/LoginStatistics";
import { LtpProjectionReport } from "@/components/LtpProjectionReport";
import { ModelDocuments } from "@/components/ModelDocuments";
import { OowTicketReport } from "@/components/OowTicketReport";
import { OpenTicketSummary } from "@/components/OpenTicketSummary";
import { PartPurchaseReport } from "@/components/PartPurchaseReport";
import { PartRevenueReport } from "@/components/PartRevenueReport";
import { PartTransactionReport } from "@/components/PartTransactionReport";
import { RedoReport } from "@/components/RedoReport";
import { ServiceLevelReport } from "@/components/ServiceLevelReport";
import { TaxReport } from "@/components/TaxReport";
import { TechDailyReport } from "@/components/TechDailyReport";
import { TechEfficiencyReport } from "@/components/TechEfficiencyReport";
import { TechPerformanceReport } from "@/components/TechPerformanceReport";
import { TechWorkOverview } from "@/components/TechWorkOverview";
import { TimecardReport } from "@/components/TimecardReport";
import { TriagePerformanceReport } from "@/components/TriagePerformanceReport";
import { TicketsMapWorkMap } from "@/components/TicketsMapWorkMap";
import { PartOrder } from "@/components/PartOrder";
import { PartReceive } from "@/components/PartReceive";
import { TicketList } from "@/components/TicketList";
import { AdminUserManagementPage } from "@/components/AdminUserManagementPage";
import { AccountManagementPage } from "@/components/AccountManagementPage";
import { LocationManagementPage } from "@/components/LocationManagementPage";
import { canAccessUserManagement, getUserManagementRecord } from "@/lib/user-management";

export const Route = createFileRoute("/m/$module/$submodule")({
  ssr: false,
  head: ({ params }) => ({
    meta: [{
      title: `${getSubModule(params.module, params.submodule)?.title ?? "Sub-module"} — Admin Hub Solutions`,
    }],
  }),
  loader: ({ params }) => {
    const m = getModule(params.module);
    const s = getSubModule(params.module, params.submodule);
    if (!m || !s) throw notFound();
    return { mod: m, sub: s };
  },
  component: SubModule,
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="panel text-center max-w-md">
        <h1 className="text-xl font-semibold">Sub-module not found</h1>
        <Link to="/home" className="btn btn-primary mt-4 inline-flex">Back home</Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="panel text-center max-w-md">
        <h1 className="text-xl font-semibold">Couldn't load page</h1>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </div>
    </div>
  ),
});

function SubModule() {
  const { ready, email, companyId } = useAuth();
  const { mod, sub } = Route.useLoaderData();
  const location = useLocation();
  if (!ready) return null;
  if (!email) return <Navigate to="/landing" />;
  if (sub.custom === "user-management" && !canAccessUserManagement(email)) {
    const currentUser = getUserManagementRecord(email);
    return (
      <>
        <AppHeader />
        <main className="flex-1 bg-slate-950 py-6">
          <div className="max-w-4xl mx-auto px-6">
            <div className="rounded-xl border border-white/15 bg-white/8 p-6 text-white backdrop-blur-md">
              <h1 className="text-2xl font-bold">Access restricted</h1>
              <p className="mt-2 text-sm text-slate-300">
                User management is only available to HR, Manager, Admin, and Super Admin users.
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Current sign-in: {currentUser?.userName ?? email}
              </p>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const hasNestedUserRoute = sub.custom === "user-management" && location.pathname.split("/").filter(Boolean).length > 3;

  if (hasNestedUserRoute) {
    return <Outlet />;
  }

  return (
    <>
      <AppHeader />
      {sub.slug === "overall-status"
        ? <OverallStatusPage mod={mod} sub={sub} companyId={companyId} />
        : sub.slug === "repair-forecast"
        ? <RepairForecastPage mod={mod} sub={sub} companyId={companyId} />
        : sub.slug === "daily-activity"
        ? <DailyActivityPage mod={mod} sub={sub} companyId={companyId} />
        : sub.custom === "part-return-status"
        ? <PartReturnStatusPage />
        : sub.custom === "claims-pipeline"
        ? <ClaimsPipeline mod={mod} sub={sub} />
        : (sub as any).custom === "need-claim-list"
        ? <NeedClaimList mod={mod} sub={sub} />
        : (sub as any).custom === "claim-list"
        ? <ClaimList mod={mod} sub={sub} />
        : (sub as any).custom === "authorization-status"
        ? <AuthorizationStatus mod={mod} sub={sub} />
        : (sub as any).custom === "claim-calendar-monthly"
        ? <ClaimCalendarMonthly mod={mod} sub={sub} />
        : (sub as any).custom === "claim-calendar-weekly"
        ? <ClaimCalendarWeekly mod={mod} sub={sub} />
        : (sub as any).custom === "claim-planner"
        ? <ClaimPlanner mod={mod} sub={sub} />
        : (sub as any).custom === "credit-card-report"
        ? <CreditCardReport mod={mod} sub={sub} />
        : (sub as any).custom === "ftf-report"
        ? <FtfReport mod={mod} sub={sub} />
        : (sub as any).custom === "ltp-report"
        ? <LtpReport mod={mod} sub={sub} />
        : (sub as any).custom === "tat-report"
        ? <TatReport mod={mod} sub={sub} />
        : (sub as any).custom === "csr-daily-work"
        ? <CsrDailyWork mod={mod} sub={sub} />
        : (sub as any).custom === "daily-activity-report"
        ? <DailyActivityReport mod={mod} sub={sub} />
        : (sub as any).custom === "internal-message-report"
        ? <InternalMessageReport mod={mod} sub={sub} />
        : (sub as any).custom === "login-statistics"
        ? <LoginStatistics mod={mod} sub={sub} />
        : (sub as any).custom === "ltp-projection-report"
        ? <LtpProjectionReport mod={mod} sub={sub} />
        : (sub as any).custom === "model-documents"
        ? <ModelDocuments mod={mod} sub={sub} />
        : (sub as any).custom === "oow-ticket-report"
        ? <OowTicketReport mod={mod} sub={sub} />
        : (sub as any).custom === "open-ticket-summary"
        ? <OpenTicketSummary mod={mod} sub={sub} />
        : (sub as any).custom === "part-purchase-report"
        ? <PartPurchaseReport mod={mod} sub={sub} />
        : (sub as any).custom === "part-revenue-report"
        ? <PartRevenueReport mod={mod} sub={sub} />
        : (sub as any).custom === "part-transaction-report"
        ? <PartTransactionReport mod={mod} sub={sub} />
        : (sub as any).custom === "redo-report"
        ? <RedoReport mod={mod} sub={sub} />
        : (sub as any).custom === "service-level-report"
        ? <ServiceLevelReport mod={mod} sub={sub} />
        : (sub as any).custom === "tax-report"
        ? <TaxReport mod={mod} sub={sub} />
        : (sub as any).custom === "tech-daily-report"
        ? <TechDailyReport mod={mod} sub={sub} />
        : (sub as any).custom === "tech-efficiency-report"
        ? <TechEfficiencyReport mod={mod} sub={sub} />
        : (sub as any).custom === "tech-performance-report"
        ? <TechPerformanceReport mod={mod} sub={sub} />
        : (sub as any).custom === "tech-work-overview"
        ? <TechWorkOverview mod={mod} sub={sub} />
        : (sub as any).custom === "timecard-report"
        ? <TimecardReport mod={mod} sub={sub} />
        : (sub as any).custom === "triage-performance-report"
        ? <TriagePerformanceReport mod={mod} sub={sub} />
        : sub.custom === "work-map"
        ? <TicketsMapWorkMap mod={mod} sub={sub} />
        : sub.custom === "part-order"
        ? <PartOrder mod={mod} sub={sub} />
        : sub.custom === "part-receive"
        ? <PartReceive mod={mod} sub={sub} />
        : sub.custom === "ticket-list"
        ? <TicketList mod={mod} sub={sub} />
        : sub.custom === "user-management"
        ? <AdminUserManagementPage mod={mod} sub={sub} />
        : sub.custom === "account-management"
        ? <AccountManagementPage mod={mod} sub={sub} />
        : sub.custom === "location-management"
        ? <LocationManagementPage mod={mod} sub={sub} />
        : <GenericModulePage mod={mod} sub={sub} />}
      <Footer />
    </>
  );
}
