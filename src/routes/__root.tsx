import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { PasswordChangeReminder } from "@/components/PasswordChangeReminder";
import { TicketSearchFab } from "@/components/TicketSearchFab";
import { ModuleNavigator } from "@/components/ModuleNavigator";
import { SystemDataInitializer } from "@/components/SystemDataInitializer";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="panel max-w-md text-center">
        <h1 className="text-6xl font-bold">404</h1>
        <h2 className="mt-3 text-lg font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That page isn't part of Admin Hub Solutions.
        </p>
        <div className="mt-5">
          <Link to="/home" className="btn btn-primary">Go to dashboard</Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="panel max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try again or head home.</p>
        <div className="mt-5 flex gap-2 justify-center">
          <button className="btn btn-primary" onClick={() => { router.invalidate(); reset(); }}>Try again</button>
          <a href="/home" className="btn">Go home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  ssr: false,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Admin Hub Solutions" },
      { name: "description", content: "Operations console for dispatch, parts, and ticketing." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/**
 * Redirects to /profile (where the existing self-service password form
 * lives) whenever an admin has flagged this account via Reset Password /
 * Reset All Passwords (see migration 0103). The user already logged in
 * with their existing password — this only blocks reaching the rest of
 * the dashboards until they actually change it, which clears the flag
 * (see profile.tsx's changePassword). Skipped on hideChrome pages (no
 * authenticated chrome there anyway) and while already on /profile.
 */
function MustChangePasswordGate({ hideChrome }: { hideChrome: boolean }) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (hideChrome) return;
    if (!auth.ready || !auth.mustChangePassword) return;
    if (location.pathname === "/profile") return;
    navigate({ to: "/profile", replace: true });
  }, [hideChrome, auth.ready, auth.mustChangePassword, location.pathname, navigate]);

  return null;
}

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

// SUPERSUPERADMIN (the platform-level role) may only ever be on /superadmin
// or its per-company detail page — home.tsx/landing.tsx already redirect it
// there right after login, but nothing stopped direct navigation elsewhere
// afterward. This is the backstop for every other route (rendered
// unconditionally, not gated by hideChrome, so it still runs on /landing,
// /mobile, etc).
function SuperSuperAdminGuard() {
  const { ready, role } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    if (role?.toUpperCase() !== "SUPERSUPERADMIN") return;
    const allowed = location.pathname === "/superadmin" || location.pathname.startsWith("/superadmin/company/");
    if (!allowed) navigate({ to: "/superadmin", replace: true });
  }, [ready, role, location.pathname, navigate]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const location = useLocation();
  const isLandingPage = location.pathname === "/landing" || location.pathname === "/announcements";
  const isSuperAdminPage = location.pathname === "/superadmin";
  const isMobilePage = location.pathname === "/mobile";
  // Public custom-form fill page — no AHS account, so none of the
  // authenticated chrome below (announcement banner, ticket search, module
  // navigator) applies or would even render sensibly.
  const isApplyPage = location.pathname.startsWith("/apply/");
  // No-login page — an anonymous external recipient signing a document has
  // no Firebase session, so the authenticated chrome below can't render.
  const isSignExternalPage = location.pathname.startsWith("/sign-external/");
  const hideChrome = isLandingPage || isSuperAdminPage || isMobilePage || isApplyPage || isSignExternalPage;
  
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <SuperSuperAdminGuard />
          <SystemDataInitializer />
          <MustChangePasswordGate hideChrome={hideChrome} />
          {!hideChrome && <AnnouncementBanner />}
          {!hideChrome && <PasswordChangeReminder />}
          <Outlet />
          {!hideChrome && <TicketSearchFab />}
          {/* Floating module navigator — sits below the AppHeader on every
              authenticated page so users can hop between modules without
              going back to /home. */}
          {!hideChrome && <ModuleNavigator />}
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
