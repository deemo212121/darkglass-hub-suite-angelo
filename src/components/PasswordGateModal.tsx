/**
 * "Enter your password to continue" — a check before opening a sensitive
 * view (Employee Monitoring → Attendance Status). Verifies the viewer's OWN
 * login password with Firebase (reauthenticateWithCredential, same as the
 * profile page's password change) — no shared password is stored anywhere.
 * Once passed, the view stays unlocked for the rest of the browser tab's
 * session (sessionStorage), so it isn't asked again on every click.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Loader2 } from "lucide-react";

export function isGateUnlocked(key: string): boolean {
  try {
    return sessionStorage.getItem(`gate:${key}`) === "1";
  } catch {
    return false;
  }
}

function markGateUnlocked(key: string) {
  try {
    sessionStorage.setItem(`gate:${key}`, "1");
  } catch {
    /* storage blocked — they'll just be asked again next time */
  }
}

export function PasswordGateModal({
  gateKey,
  title,
  onUnlocked,
  onCancel,
}: {
  gateKey: string;
  title: string;
  onUnlocked: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password) return;
    setChecking(true);
    setError(null);
    try {
      const [{ auth }, firebaseAuth] = await Promise.all([import("@/lib/firebase/config"), import("firebase/auth")]);
      const user = auth?.currentUser;
      if (!user || !user.email) {
        setError("You're not signed in.");
        return;
      }
      await firebaseAuth.reauthenticateWithCredential(user, firebaseAuth.EmailAuthProvider.credential(user.email, password));
      markGateUnlocked(gateKey);
      onUnlocked();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setError(
        code.includes("too-many-requests")
          ? "Too many tries — wait a moment and try again."
          : code.includes("wrong-password") || code.includes("invalid-credential") || code.includes("invalid-login")
          ? "That password isn't right."
          : "Couldn't check your password — try again."
      );
    } finally {
      setChecking(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onClick={() => !checking && onCancel()}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <Lock className="h-5 w-5 text-blue-400" />
          <h2 className="text-base font-bold text-white">{title}</h2>
        </div>
        <p className="text-xs text-slate-400 mb-3">Enter your login password to continue.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={checking} className="btn text-sm px-3 py-1.5">
              Cancel
            </button>
            <button type="submit" disabled={checking || !password} className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
              {checking && <Loader2 className="h-4 w-4 animate-spin" />} Continue
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
