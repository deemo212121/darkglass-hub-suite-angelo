import { createFileRoute, Link, Navigate, Outlet, notFound, redirect, useLocation } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { BrandedLoader } from "@/components/BrandedLoader";
import { PageTrail } from "@/components/PageTrail";
import { useRedirectGuard } from "@/lib/useRedirectGuard";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { getModule, getSubModule, type ModuleDef, type SubModuleDef } from "@/lib/modules";
// Richer parts components pulled from the upstream usapp repo. Where they
// overlap with the existing *Page wrappers above we prefer the upstream
// component because it has the full UI; the wrappers remain available as
// fallbacks and for any spots that still reference them.
import { canAccessUserManagement, getUserManagementRecord, canAccessAdminModule } from "@/lib/user-management";
import { isSubmoduleAllowed, isSubmoduleAllowedForTrainee, isSubmoduleAllowedForFrozen, isCompanySuperAdminRole, isCsrRestrictedRole } from "@/lib/roleLabels";
import { getDashboardRoleGate, hasDashboardAccess } from "@/lib/dashboardAccess";
import { useModuleRoleGate, useModuleRoleGateOverrides } from "@/lib/moduleAccess";
// Roles allowed into the admin module overall, and into User Management /
// Activity Logs specifically. Checked via hasDashboardAccess so a secondary
// role (profiles.extra_roles) grants access too, not just the primary role —
// e.g. a Parts Manager who's also been given Admin as a secondary role.
// Shared with submoduleAccess.ts (used by home.tsx/ModuleNavigator.tsx to
// decide what to even list) so both surfaces can never drift apart.
import { ADMIN_MODULE_ROLES, USER_MANAGEMENT_DEFAULT_ROLES, ACTIVITY_LOG_DEFAULT_ROLES, WHEREABOUTS_DEFAULT_ROLES, BIZOPS_GUIDE_DEFAULT_ROLES, PRE_AUTH_DEFAULT_ROLES, resolveSubmoduleAllowedRoles, passesModuleLevelGate } from "@/lib/submoduleAccess";
import { ROLE_LABELS } from "@/lib/roleLabels";
import { guideDepartmentFor } from "@/lib/tours/guideDepartments";
import { canSeeTicketTour } from "@/lib/tours/ticketTours";
import { ExpensesModulePage } from "@/components/ExpensesModulePage";import { StaffListPage } from "@/components/StaffListPage";
import { ItTicketsPage } from "@/components/ItTicketsPage";

// Each page below is loaded only when it is opened (2026-10-26). They were
// all imported up front, so opening any module page downloaded every page
// in the app (~5.7 MB of code, incl. the 36,000-line HR Daily Report).
const OverallStatusPage = lazy(() => import("@/components/OverallStatusPage").then((m) => ({ default: m.OverallStatusPage })));
const RepairForecastPage = lazy(() => import("@/components/RepairForecastPage").then((m) => ({ default: m.RepairForecastPage })));
const DailyActivityPage = lazy(() => import("@/components/DailyActivityPage").then((m) => ({ default: m.DailyActivityPage })));
const TriageDashboardPage = lazy(() => import("@/components/TriageDashboardPage").then((m) => ({ default: m.TriageDashboardPage })));
const UniversalActivityLogPage = lazy(() => import("@/components/UniversalActivityLogPage").then((m) => ({ default: m.UniversalActivityLogPage })));
const ReportsLibraryPage = lazy(() => import("@/components/ReportsLibraryPage").then((m) => ({ default: m.ReportsLibraryPage })));
const GenericModulePage = lazy(() => import("@/components/GenericModulePage").then((m) => ({ default: m.GenericModulePage })));
const PartReturnStatusPage = lazy(() => import("@/components/PartReturnStatus").then((m) => ({ default: m.PartReturnStatusPage })));
const ClaimsPipeline = lazy(() => import("@/components/ClaimsPipeline").then((m) => ({ default: m.ClaimsPipeline })));
const NeedClaimList = lazy(() => import("@/components/NeedClaimList").then((m) => ({ default: m.NeedClaimList })));
const ClaimList = lazy(() => import("@/components/ClaimList").then((m) => ({ default: m.ClaimList })));
const AuthorizationStatus = lazy(() => import("@/components/AuthorizationStatus").then((m) => ({ default: m.AuthorizationStatus })));
const ClaimCalendarMonthly = lazy(() => import("@/components/ClaimCalendarMonthly").then((m) => ({ default: m.ClaimCalendarMonthly })));
const ClaimCalendarWeekly = lazy(() => import("@/components/ClaimCalendarWeekly").then((m) => ({ default: m.ClaimCalendarWeekly })));
const WorkCalendarPage = lazy(() => import("@/components/WorkCalendarPage").then((m) => ({ default: m.WorkCalendarPage })));
const WorkPlannerPage = lazy(() => import("@/components/WorkPlannerPage").then((m) => ({ default: m.WorkPlannerPage })));
const ClaimPlanner = lazy(() => import("@/components/ClaimPlanner").then((m) => ({ default: m.ClaimPlanner })));
const CreditCardReport = lazy(() => import("@/components/CreditCardReport").then((m) => ({ default: m.CreditCardReport })));
const FtfReport = lazy(() => import("@/components/FtfReport").then((m) => ({ default: m.FtfReport })));
const LtpReport = lazy(() => import("@/components/LtpReport").then((m) => ({ default: m.LtpReport })));
const TatReport = lazy(() => import("@/components/TatReport").then((m) => ({ default: m.TatReport })));
const CsrDailyWork = lazy(() => import("@/components/CsrDailyWork").then((m) => ({ default: m.CsrDailyWork })));
const DailyActivityReport = lazy(() => import("@/components/DailyActivityReport").then((m) => ({ default: m.DailyActivityReport })));
const TeamMessenger = lazy(() => import("@/components/TeamMessenger").then((m) => ({ default: m.TeamMessenger })));
const LiveChatSupportPage = lazy(() => import("@/components/LiveChatSupportPage").then((m) => ({ default: m.LiveChatSupportPage })));
const LoginStatistics = lazy(() => import("@/components/LoginStatistics").then((m) => ({ default: m.LoginStatistics })));
const LtpProjectionReport = lazy(() => import("@/components/LtpProjectionReport").then((m) => ({ default: m.LtpProjectionReport })));
const ModelDocuments = lazy(() => import("@/components/ModelDocuments").then((m) => ({ default: m.ModelDocuments })));
const OowTicketReport = lazy(() => import("@/components/OowTicketReport").then((m) => ({ default: m.OowTicketReport })));
const OpenTicketSummary = lazy(() => import("@/components/OpenTicketSummary").then((m) => ({ default: m.OpenTicketSummary })));
const PartPurchaseReport = lazy(() => import("@/components/PartPurchaseReport").then((m) => ({ default: m.PartPurchaseReport })));
const PartRevenueReport = lazy(() => import("@/components/PartRevenueReport").then((m) => ({ default: m.PartRevenueReport })));
const PartTransactionReport = lazy(() => import("@/components/PartTransactionReport").then((m) => ({ default: m.PartTransactionReport })));
const RedoReport = lazy(() => import("@/components/RedoReport").then((m) => ({ default: m.RedoReport })));
const ServiceLevelReport = lazy(() => import("@/components/ServiceLevelReport").then((m) => ({ default: m.ServiceLevelReport })));
const TaxReport = lazy(() => import("@/components/TaxReport").then((m) => ({ default: m.TaxReport })));
const TechDailyReport = lazy(() => import("@/components/TechDailyReport").then((m) => ({ default: m.TechDailyReport })));
const TechEfficiencyReport = lazy(() => import("@/components/TechEfficiencyReport").then((m) => ({ default: m.TechEfficiencyReport })));
const TechPerformanceReport = lazy(() => import("@/components/TechPerformanceReport").then((m) => ({ default: m.TechPerformanceReport })));
const TechWorkOverview = lazy(() => import("@/components/TechWorkOverview").then((m) => ({ default: m.TechWorkOverview })));
const TimecardReport = lazy(() => import("@/components/TimecardReport").then((m) => ({ default: m.TimecardReport })));
const TriagePerformanceReport = lazy(() => import("@/components/TriagePerformanceReport").then((m) => ({ default: m.TriagePerformanceReport })));
const TicketsMapWorkMap = lazy(() => import("@/components/TicketsMapWorkMap").then((m) => ({ default: m.TicketsMapWorkMap })));
const PartOrder = lazy(() => import("@/components/PartOrder").then((m) => ({ default: m.PartOrder })));
const PartReceive = lazy(() => import("@/components/PartReceive").then((m) => ({ default: m.PartReceive })));
const PartFootprintPage = lazy(() => import("@/components/PartFootprintPage").then((m) => ({ default: m.PartFootprintPage })));
const PartHistoryPage = lazy(() => import("@/components/PartHistoryPage").then((m) => ({ default: m.PartHistoryPage })));
const PartManagementPage = lazy(() => import("@/components/PartManagementPage").then((m) => ({ default: m.PartManagementPage })));
const PoStatusPage = lazy(() => import("@/components/PoStatusPage").then((m) => ({ default: m.PoStatusPage })));
const ReturnPickupPage = lazy(() => import("@/components/ReturnPickupPage").then((m) => ({ default: m.ReturnPickupPage })));
const RepairStatusesPage = lazy(() => import("@/components/RepairStatusesPage").then((m) => ({ default: m.RepairStatusesPage })));
const DataMigrationPage = lazy(() => import("@/components/DataMigrationPage").then((m) => ({ default: m.DataMigrationPage })));
const LoginSecurityPage = lazy(() => import("@/components/LoginSecurityPage").then((m) => ({ default: m.LoginSecurityPage })));
const AccessibilityManagementPage = lazy(() => import("@/components/AccessibilityManagementPage").then((m) => ({ default: m.AccessibilityManagementPage })));
const ApprovalChainPage = lazy(() => import("@/components/ApprovalChainPage").then((m) => ({ default: m.ApprovalChainPage })));
const FlashTechCalendarPage = lazy(() => import("@/components/FlashTechCalendarPage").then((m) => ({ default: m.FlashTechCalendarPage })));
const PartInventory = lazy(() => import("@/components/PartInventory").then((m) => ({ default: m.PartInventory })));
const PartDailyPickup = lazy(() => import("@/components/PartDailyPickup").then((m) => ({ default: m.PartDailyPickup })));
const PartDailyCollection = lazy(() => import("@/components/PartDailyCollection").then((m) => ({ default: m.PartDailyCollection })));
const PartReturn = lazy(() => import("@/components/PartReturn").then((m) => ({ default: m.PartReturn })));
const ReservedPartList = lazy(() => import("@/components/ReservedPartList").then((m) => ({ default: m.ReservedPartList })));
const PartsDailyReportEbay = lazy(() => import("@/components/PartsDailyReportEbay").then((m) => ({ default: m.PartsDailyReportEbay })));
const PartsDashboard = lazy(() => import("@/components/PartsDashboard").then((m) => ({ default: m.PartsDashboard })));
const PartsOrderDashboard = lazy(() => import("@/components/PartsOrderDashboard").then((m) => ({ default: m.PartsOrderDashboard })));
const TicketList = lazy(() => import("@/components/TicketList").then((m) => ({ default: m.TicketList })));
const NewTicketPage = lazy(() => import("@/components/NewTicketPage").then((m) => ({ default: m.NewTicketPage })));
const TodoListPage = lazy(() => import("@/components/TodoListPage").then((m) => ({ default: m.TodoListPage })));
const AdminUserManagementPage = lazy(() => import("@/components/AdminUserManagementPage").then((m) => ({ default: m.AdminUserManagementPage })));
const AccountManagementPage = lazy(() => import("@/components/AccountManagementPage").then((m) => ({ default: m.AccountManagementPage })));
const LocationManagementPage = lazy(() => import("@/components/LocationManagementPage").then((m) => ({ default: m.LocationManagementPage })));
const TechnicianWhereaboutsPage = lazy(() => import("@/components/TechnicianWhereaboutsPage").then((m) => ({ default: m.TechnicianWhereaboutsPage })));
const AddBranchPage = lazy(() => import("@/components/AddBranchPage").then((m) => ({ default: m.AddBranchPage })));
const CompanySettingsPage = lazy(() => import("@/components/CompanySettingsPage").then((m) => ({ default: m.CompanySettingsPage })));
const ReportHRDaily = lazy(() => import("@/components/ReportHRDaily").then((m) => ({ default: m.ReportHRDaily })));
const HrOnboardingChecklistPage = lazy(() => import("@/components/HrOnboardingChecklistPage").then((m) => ({ default: m.HrOnboardingChecklistPage })));
const TechnicianFormChecklistPage = lazy(() => import("@/components/TechnicianFormChecklistPage").then((m) => ({ default: m.TechnicianFormChecklistPage })));
const HiringAnalyticsPage = lazy(() => import("@/components/HiringAnalyticsPage").then((m) => ({ default: m.HiringAnalyticsPage })));
const CandidateReviewsPage = lazy(() => import("@/components/CandidateReviewsPage").then((m) => ({ default: m.CandidateReviewsPage })));
const ClockInCodesTab = lazy(() => import("@/components/ClockInCodesTab").then((m) => ({ default: m.ClockInCodesTab })));
const TicketGuidesPage = lazy(() => import("@/components/TicketGuidesPage").then((m) => ({ default: m.TicketGuidesPage })));
const SelfServiceGuidePage = lazy(() => import("@/components/SelfServiceGuidePage").then((m) => ({ default: m.SelfServiceGuidePage })));
const GettingStartedGuidePage = lazy(() => import("@/components/GettingStartedGuidePage").then((m) => ({ default: m.GettingStartedGuidePage })));
const ServerStatusPage = lazy(() => import("@/components/ServerStatusPage").then((m) => ({ default: m.ServerStatusPage })));
const ApproverGuidePage = lazy(() => import("@/components/ApproverGuidePage").then((m) => ({ default: m.ApproverGuidePage })));
const BizOpsGuidePage = lazy(() => import("@/components/BizOpsGuidePage").then((m) => ({ default: m.BizOpsGuidePage })));
const PreAuthPage = lazy(() => import("@/components/PreAuthPage").then((m) => ({ default: m.PreAuthPage })));
const ClaimsGuidePage = lazy(() => import("@/components/ClaimsGuidePage").then((m) => ({ default: m.ClaimsGuidePage })));
const DepartmentGuidePage = lazy(() => import("@/components/DepartmentGuidePage").then((m) => ({ default: m.DepartmentGuidePage })));
const TrainingListPage = lazy(() => import("@/components/TrainingListPage").then((m) => ({ default: m.TrainingListPage })));
const AbsentListPage = lazy(() => import("@/components/AbsentListPage").then((m) => ({ default: m.AbsentListPage })));
const RepairKnowledgeBase = lazy(() => import("@/components/RepairKnowledgeBase").then((m) => ({ default: m.RepairKnowledgeBase })));
const TechGuidesPage = lazy(() => import("@/components/TechGuidesPage").then((m) => ({ default: m.TechGuidesPage })));
const ReportHR = lazy(() => import("@/components/ReportHR").then((m) => ({ default: m.ReportHR })));
const ReportCSRDaily = lazy(() => import("@/components/ReportCSRDaily").then((m) => ({ default: m.ReportCSRDaily })));
const ReportClaimsDaily = lazy(() => import("@/components/ReportClaimsDaily").then((m) => ({ default: m.ReportClaimsDaily })));
const ReportTriageDaily = lazy(() => import("@/components/ReportTriageDaily").then((m) => ({ default: m.ReportTriageDaily })));
const ReportPartsDaily = lazy(() => import("@/components/ReportPartsDaily").then((m) => ({ default: m.ReportPartsDaily })));
const ReportOperationsDaily = lazy(() => import("@/components/ReportOperationsDaily").then((m) => ({ default: m.ReportOperationsDaily })));
const ReportAttendanceMonitoring = lazy(() => import("@/components/ReportAttendanceMonitoring").then((m) => ({ default: m.ReportAttendanceMonitoring })));
const ReportAccounting = lazy(() => import("@/components/ReportAccounting").then((m) => ({ default: m.ReportAccounting })));
const BranchDailyReportPage = lazy(() => import("@/components/BranchDailyReportPage").then((m) => ({ default: m.BranchDailyReportPage })));
const TechnicianPerformanceReport = lazy(() => import("@/components/TechnicianPerformanceReport").then((m) => ({ default: m.TechnicianPerformanceReport })));
const EncompassClaimAuditReport = lazy(() => import("@/components/EncompassClaimAuditReport").then((m) => ({ default: m.EncompassClaimAuditReport })));
const MonthlyPartReport = lazy(() => import("@/components/MonthlyPartReport").then((m) => ({ default: m.MonthlyPartReport })));
const PayrollReport = lazy(() => import("@/components/PayrollReport").then((m) => ({ default: m.PayrollReport })));
const UnclaimedPartsReport = lazy(() => import("@/components/UnclaimedPartsReport").then((m) => ({ default: m.UnclaimedPartsReport })));
const RepairCodeRestriction = lazy(() => import("@/components/RepairCodeRestriction").then((m) => ({ default: m.RepairCodeRestriction })));
const SalesSummaryReport = lazy(() => import("@/components/SalesSummaryReport").then((m) => ({ default: m.SalesSummaryReport })));
const TechPayrollSetup = lazy(() => import("@/components/TechPayrollSetup").then((m) => ({ default: m.TechPayrollSetup })));
const PaymentReport = lazy(() => import("@/components/PaymentReport").then((m) => ({ default: m.PaymentReport })));
const ClosingReport = lazy(() => import("@/components/ClosingReport").then((m) => ({ default: m.ClosingReport })));
const RepairStatusReport = lazy(() => import("@/components/RepairStatusReport").then((m) => ({ default: m.RepairStatusReport })));
const AccountingDashboard = lazy(() => import("@/components/AccountingDashboard").then((m) => ({ default: m.AccountingDashboard })));
const AttendanceMonitoringPage = lazy(() => import("@/components/AttendanceMonitoringPage").then((m) => ({ default: m.AttendanceMonitoringPage })));
const PayrollCalculationPage = lazy(() => import("@/components/PayrollCalculationPage").then((m) => ({ default: m.PayrollCalculationPage })));
const GeneralInfoPage = lazy(() => import("@/components/GeneralInfoPage").then((m) => ({ default: m.GeneralInfoPage })));
const EmployeeSelfServicePage = lazy(() => import("@/components/EmployeeSelfServicePage").then((m) => ({ default: m.EmployeeSelfServicePage })));
const CSRMainDashboard = lazy(() => import("@/components/CSRMainDashboard").then((m) => ({ default: m.CSRMainDashboard })));
const CSRTeamDailyReport = lazy(() => import("@/components/CSRTeamDailyReport").then((m) => ({ default: m.CSRTeamDailyReport })));
const CsrRescheduleRequestsPage = lazy(() => import("@/components/CsrRescheduleRequestsPage").then((m) => ({ default: m.CsrRescheduleRequestsPage })));
const CsrGhTracker = lazy(() => import("@/components/CsrGhTracker").then((m) => ({ default: m.CsrGhTracker })));
const CsrLtpReport = lazy(() => import("@/components/CsrLtpReport").then((m) => ({ default: m.CsrLtpReport })));
const CsrCoachingLogPage = lazy(() => import("@/components/CsrCoachingLogPage").then((m) => ({ default: m.CsrCoachingLogPage })));
const CSRCallTracker = lazy(() => import("@/components/CSRCallTracker").then((m) => ({ default: m.CSRCallTracker })));
const CSRStatusSummary = lazy(() => import("@/components/CSRStatusSummary").then((m) => ({ default: m.CSRStatusSummary })));
const ExpenseTrackingPage = lazy(() => import("@/components/ExpenseTrackingPage").then((m) => ({ default: m.ExpenseTrackingPage })));
const ClaimsDashboard = lazy(() => import("@/components/ClaimsDashboard").then((m) => ({ default: m.ClaimsDashboard })));
const ClaimsDailyReport = lazy(() => import("@/components/ClaimsDailyReport").then((m) => ({ default: m.ClaimsDailyReport })));
const OperationsDashboard = lazy(() => import("@/components/OperationsDashboard").then((m) => ({ default: m.OperationsDashboard })));
const ReceivingStatusPage = lazy(() => import("@/components/ReceivingStatusPage").then((m) => ({ default: m.ReceivingStatusPage })));
const NoCoverageTicketsPage = lazy(() => import("@/components/NoCoverageTicketsPage").then((m) => ({ default: m.NoCoverageTicketsPage })));
const TicketOperationReport = lazy(() => import("@/components/TicketOperationReport").then((m) => ({ default: m.TicketOperationReport })));

const MOVED_SUBMODULES: Record<string, { module: string; submodule: string }> = {
  "tickets/operation": { module: "bizops", submodule: "operation" },
};

export const Route = createFileRoute("/m/$module/$submodule")({
  ssr: false,
  head: ({ params }) => ({
    meta: [{
      title: `${getSubModule(params.module, params.submodule)?.title ?? "Sub-module"} — Admin Hub Solutions`,
    }],
  }),
  loader: async ({ params }) => {
    // Pages that moved to another module — old links/bookmarks land on the new spot.
    const moved = MOVED_SUBMODULES[`${params.module}/${params.submodule}`];
    if (moved) throw redirect({ to: "/m/$module/$submodule", params: moved, replace: true });
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
  const { ready, email, companyId, role, extraRoles, uid, isTrainee, isFrozen } = useAuth();
  // Route.useLoaderData()'s type resolves to `undefined` for this route in
  // the current @tanstack/react-router version — a known inference gap for
  // parent routes with children, not a real runtime issue (the loader
  // always returns { mod, sub } or throws notFound() first).
  const { mod, sub } = Route.useLoaderData() as { mod: ModuleDef; sub: SubModuleDef };
  const location = useLocation();
  // Guards every <Navigate> below against firing more than once per
  // distinct target — see useRedirectGuard.ts for why this is necessary.
  const redirectOnce = useRedirectGuard();

  // Role gates that also need to honor a secondary role (profiles.
  // extra_roles) — a Parts Manager who's ALSO been given Admin as a
  // secondary role should still get into the admin module, not just users
  // whose PRIMARY role is Admin/SuperAdmin. extraRoles comes straight from
  // useAuth() (already loaded at login, no second fetch needed) rather
  // than a separate getMyRoles(uid) DB call this file used to make — that
  // second call read the REAL signed-in account's extra_roles directly
  // from the database, which silently ignored a Super Admin's "View as"
  // role preview: previewing as a role with no access still let them
  // through if their REAL account happened to hold a matching secondary
  // role (exactly what a Super Admin testing "does revoking this role's
  // access actually work" would trip over, since their own real account
  // commonly holds several secondary roles for its own day-to-day use).
  // useAuth().extraRoles is already the correctly-simulated value during a
  // preview (forced to [] — see auth.tsx's effectiveExtraRoles).
  //
  // Raw override only (no Dashboard hardcoded-default folded in) — whether
  // an admin has explicitly set this exact (module, submodule)'s allowed
  // roles via Accessibility Management's Module Access by Role grid. When
  // one exists it's AUTHORITATIVE and bypasses the CSR-department
  // restriction below (isSubmoduleAllowed already covers both the
  // module-level and submodule-level CSR checks in one call) — an admin
  // who explicitly checked a role's box means it, even for a normally
  // CSR-restricted role. Without an override, the CSR restriction (and,
  // for Dashboard, its own hardcoded per-submodule default) still applies
  // exactly as before this system existed.
  // Reactive — re-renders this page immediately when this (module,
  // submodule)'s override changes, whether saved from this same tab or
  // pushed live from another session via auth.tsx's realtime subscription.
  // Someone sitting on a page an admin just revoked sees "Access
  // restricted" right away instead of only after their next reload.
  const explicitModuleOverride = useModuleRoleGate(mod.slug, sub.slug);
  // Re-check on ANY access-rule change (the module-level gate and the
  // Dashboard-family fallbacks below read the cache synchronously), not just
  // this exact (module, submodule) pair.
  useModuleRoleGateOverrides();
  // moduleAllowedRoles covers every module, not just Dashboard: the
  // Dashboard module additionally has a hardcoded default per submodule
  // (getDashboardRoleGate, DASHBOARD_ROLE_GATES) for when there's no
  // company override; every other module has no hardcoded default, so
  // null here (no override) means open to every role, same as before this
  // system existed. This is purely additive on top of the admin-module/
  // user-management/company-settings gates below — it can only narrow
  // access further there, never grant access past one of those.
  //
  // "accounting" and "csr" are included alongside "dashboard"/"hr" here
  // because accounting-dashboard's hardcoded ADMIN/FINANCE default and
  // daily-report/team-composition's hardcoded ADMIN/CSR_MANAGER/etc.
  // default (DASHBOARD_ROLE_GATES) both live in this same map even though
  // they moved out of the Dashboard module into their own Accounting/CSR
  // modules (see modules.ts) — without this, a company with no explicit
  // override configured would fall through to explicitModuleOverride's
  // null and open the page to every signed-in role.
  // "receiving-status" (Tickets module) is special-cased here rather than
  // added to the mod.slug list above — Tickets also has its own unrelated
  // "todo-list" submodule, and blanket-including "tickets" in that list
  // would make it inherit HR's "todo-list" DASHBOARD_ROLE_GATES entry too
  // (gates are keyed by submodule slug alone). See dashboardAccess.ts.
  // Shared with canAccessSubmodule (Home/Modules strip) so a tile is only
  // listed if this page would actually let the viewer in. receiving-status
  // keeps its own special case (see dashboardAccess.ts).
  const moduleAllowedRoles = (sub as any).custom === "receiving-status"
    ? (explicitModuleOverride ?? getDashboardRoleGate(sub.slug))
    : resolveSubmoduleAllowedRoles(mod.slug, sub.slug, explicitModuleOverride);

  if (!ready) return null;
  if (!email) return redirectOnce("/landing") ? <Navigate to="/landing" replace /> : null;

  // Trainees only see Employee Self-Service — checked first, before any
  // role-based gate below, since it doesn't depend on role or extra_roles
  // at all. This is the actual enforcement stopping a trainee from
  // bypassing a hidden tile by typing the URL directly; unlike the CSR
  // check further down, it's NOT lifted by an explicit Module Access
  // override — employment_type = "trainee" is meant as an absolute
  // restriction while it's set, not something a leftover permission grant
  // can quietly punch a hole in.
  if (!isSubmoduleAllowedForTrainee(isTrainee, mod.slug, sub.slug)) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Whole-module lockout (Accessibility Management's module-level box) is
  // authoritative for every page in the module, same as Home and the
  // module's own tile grid — a pasted/bookmarked link to a page inside a
  // module this role is locked out of goes Home. (Admin is exempt inside
  // passesModuleLevelGate — its own gate below handles its carve-outs.)
  if (!passesModuleLevelGate(role, extraRoles, mod.slug)) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Frozen accounts only see Messages — same absolute, override-proof
  // restriction shape as the Trainee block above, just a narrower
  // allow-list and independent of it (see roleLabels.ts's
  // isSubmoduleAllowedForFrozen). Server-side, a frozen technician's own
  // timecard punch and any ticket write are also blocked by DB triggers
  // (migration 0223) — this only covers page-level access.
  if (!isSubmoduleAllowedForFrozen(isFrozen, mod.slug, sub.slug)) {
    return (
      <>
        <AppHeader />
        <main className="flex-1 bg-slate-950 py-6">
          <div className="max-w-4xl mx-auto px-6">
            <div className="rounded-xl border border-white/15 bg-white/8 p-6 text-white backdrop-blur-md">
              <h1 className="text-2xl font-bold">Account frozen</h1>
              <p className="mt-2 text-sm text-slate-300">
                Your account has been frozen — you can still open Messages to complete any pending forms, but nothing else is available right now. Contact HR if you have questions.
              </p>
              <Link
                to="/m/$module/$submodule"
                params={{ module: "admin", submodule: "internal-message-support" }}
                className="btn btn-primary mt-4 inline-flex"
              >
                Go to Messages
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  // CSR Agents/Team Leaders get a narrow allow-list (their own Dashboard
  // tools + Tickets) — this is what actually stops someone from bypassing
  // the hidden tiles by typing the URL directly. Skipped entirely when an
  // admin has explicitly overridden this exact submodule's roles.
  if (!explicitModuleOverride && !isSubmoduleAllowed(role, mod.slug, sub.slug, extraRoles)) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Check admin access using Firebase role — primary role OR a secondary
  // role (extra_roles) of Admin/SuperAdmin both grant access.
  const hasAdminAccess = hasDashboardAccess(ADMIN_MODULE_ROLES, role, extraRoles);

  // Carve-outs: a few admin-module pages are open to everyone since they're
  // company-wide utilities (e.g. the internal team messenger).
  const ALL_ROLES_ADMIN_SUBMODULES = new Set(["internal-message-support"]);

  // IT Tickets is also reachable from the Admin module (in addition to
  // Dashboard) — reuse the same DASHBOARD_ROLE_GATES allow-list so IT and
  // Senior-tier managers can open this one card without full Admin access;
  // ItTicketsPage.tsx itself further splits edit (IT/Admin) vs read-only
  // (Senior Managers), and the it_tickets RLS policies enforce it either way.
  const hasItTicketsAccess = sub.custom === "it-tickets" && hasDashboardAccess(getDashboardRoleGate("it-tickets") || [], role, extraRoles);

  // User Management and Activity Logs both have their own, more permissive
  // role lists below (explicitModuleOverride, falling back to
  // USER_MANAGEMENT_DEFAULT_ROLES / ACTIVITY_LOG_DEFAULT_ROLES) — carved
  // out here so someone who qualifies via one of THOSE lists but isn't
  // Admin/SuperAdmin doesn't get blocked by this broader gate before ever
  // reaching their dedicated check.
  const isUserManagementSubmodule = sub.custom === "user-management";
  const isActivityLogSubmodule = (sub as any).custom === "universal-activity-log";
  // Technician Whereabouts: Technical Director also needs this for
  // dispatch/route visibility, same carve-out reasoning as Activity Logs
  // already gets for Senior Branch Manager just above.
  const isWhereaboutsSubmodule = (sub as any).custom === "technician-whereabouts";

  if (
    mod.slug === "admin" &&
    !hasAdminAccess &&
    !hasItTicketsAccess &&
    !ALL_ROLES_ADMIN_SUBMODULES.has(sub.slug) &&
    !isUserManagementSubmodule &&
    !isActivityLogSubmodule &&
    !isWhereaboutsSubmodule
  ) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Check user management access using Firebase role — same primary-or-
  // secondary-role logic as the admin gate above. USER_MANAGEMENT_DEFAULT_
  // ROLES is only the fallback when no company override exists (module
  // "admin", submodule "user-management") — Accessibility Management can
  // narrow or widen this like any other page's access.
  const userManagementAllowedRoles = explicitModuleOverride ?? USER_MANAGEMENT_DEFAULT_ROLES;
  const hasUserManagementAccess = hasDashboardAccess(userManagementAllowedRoles, role, extraRoles);

  if (isUserManagementSubmodule && !hasUserManagementAccess) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Activity Logs — same carve-out pattern as User Management above.
  const activityLogAllowedRoles = explicitModuleOverride ?? ACTIVITY_LOG_DEFAULT_ROLES;
  const hasActivityLogAccess = hasDashboardAccess(activityLogAllowedRoles, role, extraRoles);

  if (isActivityLogSubmodule && !hasActivityLogAccess) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Technician Whereabouts — same carve-out pattern as User Management/
  // Activity Logs above.
  const whereaboutsAllowedRoles = explicitModuleOverride ?? WHEREABOUTS_DEFAULT_ROLES;
  const hasWhereaboutsAccess = hasDashboardAccess(whereaboutsAllowedRoles, role, extraRoles);

  if (isWhereaboutsSubmodule && !hasWhereaboutsAccess) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Company Settings is narrower than the general admin-module gate above —
  // only the per-company SUPERADMIN role (or the platform SUPERSUPERADMIN,
  // as a superset) gets in, NOT a plain ADMIN.
  const hasCompanySettingsAccess = isCompanySuperAdminRole(role, extraRoles);

  if (sub.custom === "company-settings" && !hasCompanySettingsAccess) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Guides → BizOps Operations: BizOps roles plus Admin / SuperAdmin only.
  if ((sub as any).custom === "bizops-guide" && !hasDashboardAccess(explicitModuleOverride ?? BIZOPS_GUIDE_DEFAULT_ROLES, role, extraRoles)) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Claims → Pre-Auth: Claims, Parts and BizOps roles plus Admin / SuperAdmin only.
  if (((sub as any).custom === "pre-auth" || (sub as any).custom === "claims-guide") && !hasDashboardAccess(explicitModuleOverride ?? PRE_AUTH_DEFAULT_ROLES, role, extraRoles)) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  // Guides → department tiles: that department's roles only (Admin / SuperAdmin see every one).
  const guideDept = String((sub as any).custom ?? "").startsWith("guide-") ? guideDepartmentFor((sub as any).custom) : null;
  if (guideDept && !explicitModuleOverride && !canSeeTicketTour(guideDept.roleKey, role, extraRoles)) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  const hasNestedUserRoute = sub.custom === "user-management" && location.pathname.split("/").filter(Boolean).length > 3;

  if (hasNestedUserRoute) {
    return <Outlet />;
  }

  // Module/submodule role gate resolution.
  // internal-message-support stays exempt here too, not just from the
  // "admin module" gate above (ALL_ROLES_ADMIN_SUBMODULES) — otherwise a
  // company configuring ANY role-gate override for it via Accessibility
  // Management (which doesn't know this submodule is meant to be
  // unrestrictable) would silently lock most roles out of the company-wide
  // Team Messenger, defeating the whole point of that carve-out.
  const moduleAccessOk =
    !moduleAllowedRoles ||
    (mod.slug === "admin" && ALL_ROLES_ADMIN_SUBMODULES.has(sub.slug)) ||
    hasDashboardAccess(moduleAllowedRoles, role, extraRoles);

  if (moduleAllowedRoles && !moduleAccessOk) {
    return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;
  }

  return (
    <>
      <AppHeader />
      <PageTrail mod={mod} sub={sub} />
      <Suspense fallback={<BrandedLoader label="Loading page..." delayMs={150} />}>
      {sub.slug === "overall-status"
        ? <OverallStatusPage mod={mod} sub={sub} companyId={companyId} />
        : sub.slug === "repair-forecast"
        ? <RepairForecastPage mod={mod} sub={sub} companyId={companyId} />
        : sub.slug === "daily-activity"
        ? <DailyActivityPage mod={mod} sub={sub} companyId={companyId} />
        : sub.slug === "triage-dashboard"
        ? <TriageDashboardPage mod={mod} sub={sub} companyId={companyId} />
        : sub.slug === "expense-tracking"
        ? <ExpenseTrackingPage mod={mod} sub={sub} />
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
        : (sub as any).custom === "pre-auth"
        ? <PreAuthPage mod={mod} sub={sub} />
        : (sub as any).custom === "claim-calendar-monthly"
        ? <ClaimCalendarMonthly mod={mod} sub={sub} />
        : (sub as any).custom === "claim-calendar-weekly"
        ? <ClaimCalendarWeekly mod={mod} sub={sub} />
        : sub.slug === "work-calendar"
        ? <WorkCalendarPage mod={mod} sub={sub} />
        : sub.slug === "work-planner"
        ? <WorkPlannerPage mod={mod} sub={sub} />
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
        : (sub as any).custom === "internal-message-support"
        ? <TeamMessenger mod={mod} sub={sub} />
        : (sub as any).custom === "live-chat-support"
        ? <LiveChatSupportPage mod={mod} sub={sub} />
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
        : (sub as any).custom === "report-hr-daily"
        ? <ReportHR mod={mod} sub={sub} />
        : (sub as any).custom === "claims-daily-report"
        ? <ClaimsDailyReport mod={mod} sub={sub} />
        : (sub as any).custom === "report-claims-daily"
        ? <ReportClaimsDaily mod={mod} sub={sub} />
        : (sub as any).custom === "report-triage-daily"
        ? <ReportTriageDaily mod={mod} sub={sub} />
        : (sub as any).custom === "repair-knowledge"
        ? <RepairKnowledgeBase mod={mod} sub={sub} />
        : (sub as any).custom === "tech-guides"
        ? <TechGuidesPage mod={mod} sub={sub} />
        : (sub as any).custom === "report-parts-daily"
        ? <ReportPartsDaily mod={mod} sub={sub} />
        : (sub as any).custom === "report-operations-daily"
        ? <ReportOperationsDaily mod={mod} sub={sub} />
        : (sub as any).custom === "report-attendance-monitoring"
        ? <ReportAttendanceMonitoring mod={mod} sub={sub} />
        : (sub as any).custom === "report-accounting"
        ? <ReportAccounting mod={mod} sub={sub} />
        : (sub as any).custom === "report-branch-daily"
        ? <BranchDailyReportPage mod={mod} sub={sub} />
        : (sub as any).custom === "report-technician-performance"
        ? <TechnicianPerformanceReport mod={mod} sub={sub} />
        : (sub as any).custom === "encompass-claim-audit-report"
        ? <EncompassClaimAuditReport mod={mod} sub={sub} />
        : (sub as any).custom === "monthly-part-report"
        ? <MonthlyPartReport mod={mod} sub={sub} />
        : (sub as any).custom === "payroll-report"
        ? <PayrollReport mod={mod} sub={sub} />
        : (sub as any).custom === "unclaimed-parts-report"
        ? <UnclaimedPartsReport mod={mod} sub={sub} />
        : (sub as any).custom === "repair-code-restriction"
        ? <RepairCodeRestriction mod={mod} sub={sub} />
        : (sub as any).custom === "sales-summary-report"
        ? <SalesSummaryReport mod={mod} sub={sub} />
        : (sub as any).custom === "tech-payroll-setup"
        ? <TechPayrollSetup mod={mod} sub={sub} />
        : (sub as any).custom === "payment-report"
        ? <PaymentReport mod={mod} sub={sub} />
        : (sub as any).custom === "closing-report"
        ? <ClosingReport mod={mod} sub={sub} />
        : (sub as any).custom === "repair-status-report"
        ? <RepairStatusReport mod={mod} sub={sub} />
        : (sub as any).custom === "accounting-dashboard"
        ? <AccountingDashboard mod={mod} sub={sub} />
        : (sub as any).custom === "attendance-monitoring"
        ? <AttendanceMonitoringPage mod={mod} sub={sub} />
        : (sub as any).custom === "payroll-calculation"
        ? <PayrollCalculationPage mod={mod} sub={sub} />
        : (sub as any).custom === "general-information"
        ? <GeneralInfoPage mod={mod} sub={sub} />
        : (sub as any).custom === "employee-self-service"
        ? <EmployeeSelfServicePage mod={mod} sub={sub} />
        : (sub as any).custom === "it-tickets"
        ? <ItTicketsPage mod={mod} sub={sub} />
        : (sub as any).custom === "csr-main-dashboard"
        ? <CSRMainDashboard mod={mod} sub={sub} />
        : (sub as any).custom === "csr-team-daily-report"
        ? <CSRTeamDailyReport mod={mod} sub={sub} />
        : (sub as any).custom === "csr-reschedule-requests"
        ? <CsrRescheduleRequestsPage mod={mod} sub={sub} />
        : (sub as any).custom === "csr-gh-tracker"
        ? <CsrGhTracker mod={mod} sub={sub} />
        : (sub as any).custom === "csr-ltp-report"
        ? <CsrLtpReport mod={mod} sub={sub} />
        : (sub as any).custom === "csr-coaching-log"
        ? <CsrCoachingLogPage mod={mod} sub={sub} />
        : (sub as any).custom === "csr-daily-report"
        ? <ReportCSRDaily mod={mod} sub={sub} />
        : (sub as any).custom === "call-tracker"
        ? <CSRCallTracker mod={mod} sub={sub} />
        : (sub as any).custom === "csr-status-summary"
        ? <CSRStatusSummary mod={mod} sub={sub} />
        : (sub as any).custom === "hr-dashboard"
        ? <ReportHRDaily mod={mod} sub={sub} />
        : (sub as any).custom === "hr-paperworks"
        ? <ReportHRDaily mod={mod} sub={sub} />
        : (sub as any).custom === "hr-todo-list"
        ? <HrOnboardingChecklistPage />
        : (sub as any).custom === "technician-form-checklist"
        ? <TechnicianFormChecklistPage />
        : (sub as any).custom === "hiring-analytics"
        ? <HiringAnalyticsPage />
        : (sub as any).custom === "training-list"
        ? <TrainingListPage />
        : (sub as any).custom === "candidate-reviews"
        ? <CandidateReviewsPage />
        : (sub as any).custom === "ticket-guides"
        ? <TicketGuidesPage />
        : (sub as any).custom === "self-service-guide"
        ? <SelfServiceGuidePage />
        : (sub as any).custom === "getting-started-guide"
        ? <GettingStartedGuidePage />
        : (sub as any).custom === "server-status"
        ? <ServerStatusPage />
        : (sub as any).custom === "approver-guide"
        ? <ApproverGuidePage />
        : (sub as any).custom === "bizops-guide"
        ? <BizOpsGuidePage />
        : (sub as any).custom === "claims-guide"
        ? <ClaimsGuidePage />
        : guideDept
        ? <DepartmentGuidePage dept={guideDept} />
        : (sub as any).custom === "clock-in-codes"
        ? <ClockInCodesTab standalone backModule={mod.slug} />
        : (sub as any).custom === "absent-list"
        ? <AbsentListPage mod={mod} sub={sub} />
        : (sub as any).custom === "flash-tech"
        ? <FlashTechCalendarPage mod={mod} sub={sub} />
        : (sub as any).custom === "expenses"
        ? <ExpensesModulePage mod={mod} sub={sub} />
        : sub.custom === "staff-list"
        ? <StaffListPage mod={mod} sub={sub} />
        : sub.custom === "work-map"
        ? <TicketsMapWorkMap mod={mod} sub={sub} />
        : sub.custom === "part-order"
        ? <PartOrder mod={mod} sub={sub} />
        : sub.custom === "part-receive"
        ? <PartReceive mod={mod} sub={sub} />
        : sub.custom === "part-return"
        ? <PartReturn mod={mod} sub={sub} />
        : sub.custom === "return-pickup"
        ? <ReturnPickupPage />
        : sub.custom === "repair-statuses"
        ? <RepairStatusesPage mod={mod} />
        : (sub as any).custom === "data-migration"
        ? <DataMigrationPage mod={mod} sub={sub} />
        : (sub as any).custom === "login-security"
        ? <LoginSecurityPage mod={mod} sub={sub} />
        : (sub as any).custom === "accessibility-management"
        ? <AccessibilityManagementPage mod={mod} sub={sub} />
        : (sub as any).custom === "approval-chain"
        ? <ApprovalChainPage mod={mod} sub={sub} />
        : (sub as any).custom === "flash-tech-calendar"
        ? <FlashTechCalendarPage mod={mod} sub={sub} />
        : (sub as any).custom === "company-settings"
        ? <CompanySettingsPage mod={mod} sub={sub} />
        : (sub as any).custom === "parts-dashboard"
        ? <PartsDashboard mod={mod} sub={sub} />
        : (sub as any).custom === "parts-order-dashboard"
        ? <PartsOrderDashboard mod={mod} sub={sub} />
        : (sub as any).custom === "claims-dashboard"
        ? <ClaimsDashboard mod={mod} sub={sub} />
        : (sub as any).custom === "operations-dashboard"
        ? <OperationsDashboard mod={mod} sub={sub} />
        : sub.custom === "reserved-part-list-custom"
        ? <ReservedPartList mod={mod} sub={sub} />
        : (sub as any).custom === "part-daily-report-ebay"
        ? <PartsDailyReportEbay mod={mod} sub={sub} />
        : sub.slug === "po-status"
        ? <PoStatusPage />
        : sub.slug === "part-collection"
        ? <PartDailyCollection mod={mod} sub={sub} />
        : sub.slug === "part-footprint"
        ? <PartFootprintPage mod={mod} sub={sub} />
        : sub.slug === "part-history"
        ? <PartHistoryPage mod={mod} sub={sub} />
        : sub.slug === "part-inventory"
        ? <PartInventory mod={mod} sub={sub} />
        : sub.slug === "part-management"
        ? <PartManagementPage mod={mod} sub={sub} />
        : sub.slug === "part-pickup"
        ? <PartDailyPickup mod={mod} sub={sub} />
        : sub.slug === "part-return"
        ? <PartReturn mod={mod} sub={sub} />
        : sub.slug === "reserved-part-list"
        ? <ReservedPartList mod={mod} sub={sub} />
        : sub.custom === "ticket-list"
        ? <TicketList mod={mod} sub={sub} />
        : (sub as any).custom === "receiving-status"
        ? <ReceivingStatusPage mod={mod} sub={sub} />
        : (sub as any).custom === "no-coverage-tickets"
        ? <NoCoverageTicketsPage mod={mod} sub={sub} />
        : (sub as any).custom === "ticket-operation-report"
        ? <TicketOperationReport mod={mod} sub={sub} />
        : sub.slug === "new-ticket"
        ? <NewTicketPage mod={mod} sub={sub} />
        : sub.slug === "todo-list"
        ? <TodoListPage mod={mod} sub={sub} />
        : sub.custom === "user-management"
        ? <AdminUserManagementPage mod={mod} sub={sub} />
        : sub.custom === "account-management"
        ? <AccountManagementPage mod={mod} sub={sub} />
        : sub.custom === "location-management"
        ? <LocationManagementPage mod={mod} sub={sub} />
        : (sub as any).custom === "technician-whereabouts"
        ? <TechnicianWhereaboutsPage mod={mod} sub={sub} />
        : (sub as any).custom === "universal-activity-log"
        ? <UniversalActivityLogPage mod={mod} sub={sub} />
        : (sub as any).custom === "reports-library"
        ? <ReportsLibraryPage mod={mod} sub={sub} />
        : (sub as any).custom === "add-branch"
        ? <AddBranchPage mod={mod} sub={sub} />
        : <GenericModulePage mod={mod} sub={sub} />}
      </Suspense>
      <Footer />
    </>
  );
}
