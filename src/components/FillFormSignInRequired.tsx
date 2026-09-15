/**
 * Shown by every login-gated Fill*Page/Sign*Page (a form reached via a
 * direct DM link, not through the dashboard shell) when Firebase auth has
 * settled (`ready`) but there's no signed-in user (`uid`) — instead of the
 * page's own `loading` state staying stuck at its initial `true` forever
 * (that state only ever flips to false inside an effect gated on
 * `if (!ready || !uid) return;`, so with no uid it silently never runs,
 * leaving whoever opened the link on an infinite "Loading document…"
 * spinner with no explanation). Most commonly hit when someone opens a form
 * link in a browser/tab/device where they aren't currently logged into AHS,
 * or their session expired.
 */
import { Link } from "@tanstack/react-router";

export function FillFormSignInRequired() {
  return (
    <div className="panel p-6 text-center">
      <p className="text-sm font-semibold mb-2">You need to be signed in to open this form.</p>
      <p className="text-xs text-muted-foreground mb-4">Log in to AHS, then open this link again from your message.</p>
      <Link to="/landing" className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white inline-block">
        Log In
      </Link>
    </div>
  );
}
