/**
 * One active session per account (migration 0124) — shown the moment this
 * device is signed out because the account logged in somewhere else (see
 * checkAndHandleSession in src/lib/auth.tsx). Rendered unconditionally in
 * __root.tsx (outside the hideChrome guard, same as MustChangePasswordGate)
 * so it's visible even after the user lands back on the login page, not
 * just inside the authenticated chrome.
 */
import { ShieldAlert, X } from "lucide-react";
import { useAuth } from "@/lib/auth";

export function SessionKickedOutBanner() {
  const { kickedOut, dismissKickedOut } = useAuth();

  if (!kickedOut) return null;

  // Hard reload rather than a client-side navigate — same convention as the
  // manual Logout menu item (Header.tsx). Being kicked out means another
  // device just claimed this session; a soft SPA navigate would leave this
  // tab's whole React tree (and any in-memory state built on the old
  // session) alive underneath the login page instead of starting clean.
  const goToLogin = () => {
    dismissKickedOut();
    window.location.href = "/landing";
  };

  return (
    <div className="fixed inset-x-0 top-0 z-[100] px-4 pt-4">
      <div className="mx-auto flex w-full max-w-2xl items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/95 p-4 text-white shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-red-400/30 bg-red-400/10 text-red-300">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">You've been signed out</p>
          <p className="mt-1 text-sm text-red-100/90">
            Your account signed in on another device or browser. Only one session is allowed at a time.
          </p>
          <button
            type="button"
            onClick={goToLogin}
            className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
          >
            Log In Again
          </button>
        </div>
        <button
          type="button"
          onClick={dismissKickedOut}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-red-100 transition hover:bg-white/10"
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
