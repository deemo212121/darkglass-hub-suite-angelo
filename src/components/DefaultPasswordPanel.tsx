import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { auth as firebaseAuth } from "@/lib/firebase/config";

/**
 * Login Security → Default Password (Admin / SuperAdmin only).
 *
 * Sets the company's default password — the one new accounts start with and
 * that "Reset to default" / Forgot Password reset to (defaultPasswordBridge.ts).
 * Set-only: the server never sends the current value back, so this shows
 * when it was last changed and by whom, never the password itself.
 */

interface Status {
  isSet: boolean;
  source: "company" | "server" | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

async function callDefaultPassword(body: Record<string, unknown>) {
  const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
  if (!idToken) throw new Error("Not signed in.");
  const res = await fetch("/api/default-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function problemWith(pw: string, confirm: string): string | null {
  if (!pw) return null;
  if (pw !== pw.trim()) return "Can't start or end with a space.";
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 64) return "Use 64 characters or fewer.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use at least one letter and one number.";
  if (confirm && confirm !== pw) return "The two passwords don't match.";
  return null;
}

export function DefaultPasswordPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoadError(null);
    try {
      setStatus((await callDefaultPassword({ action: "status" })) as Status);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load.");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const problem = problemWith(pw, confirm);
  const canSave = !!pw && pw === confirm && !problem && !saving;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const data = await callDefaultPassword({ action: "set", password: pw });
      setStatus({ isSet: true, source: "company", updatedAt: data.updatedAt, updatedByName: data.updatedByName });
      setPw("");
      setConfirm("");
      setShow(false);
      toast.success("Default password saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="panel space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-500/15 text-blue-300">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Default password</h2>
            <p className="text-sm text-muted-foreground">
              The password new accounts start with, and the one "Reset to default" and Forgot Password reset to. People must choose their own right
              after they log in with it.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm">
          {loadError ? (
            <span className="text-red-300">{loadError}</span>
          ) : !status ? (
            <span className="text-muted-foreground">Loading…</span>
          ) : status.source === "company" ? (
            <>
              <span className="font-semibold text-emerald-300">Set</span>
              <span className="text-muted-foreground">
                {" "}
                · last changed {status.updatedAt ? new Date(status.updatedAt).toLocaleString() : "—"}
                {status.updatedByName ? ` by ${status.updatedByName}` : ""}
              </span>
            </>
          ) : status.source === "server" ? (
            <>
              <span className="font-semibold text-amber-300">Using the server's fallback</span>
              <span className="text-muted-foreground"> · set one here so your company controls it.</span>
            </>
          ) : (
            <>
              <span className="font-semibold text-red-300">Not set</span>
              <span className="text-muted-foreground"> · new accounts, resets and Forgot Password won't work until you set one.</span>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          For safety this page never shows the current password — only when it was changed. Setting a new one doesn't change anyone's existing
          password; it applies to the next account created or reset.
        </p>
      </section>

      <form onSubmit={save} className="panel space-y-4">
        <h3 className="text-sm font-semibold">{status?.source === "company" ? "Change the default password" : "Set the default password"}</h3>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs font-semibold uppercase">New default password</span>
          <div className="relative mt-1">
            <input
              className="glass-input w-full pr-10"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              disabled={saving}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground text-xs font-semibold uppercase">Type it again</span>
          <input
            className="glass-input mt-1 w-full"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={saving}
          />
        </label>
        <p className={`text-xs ${problem ? "text-red-300" : "text-muted-foreground"}`}>
          {problem ?? "8–64 characters, with at least one letter and one number."}
        </p>
        <button type="submit" className="btn btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canSave}>
          {saving ? "Saving…" : "Save default password"}
        </button>
      </form>
    </div>
  );
}
