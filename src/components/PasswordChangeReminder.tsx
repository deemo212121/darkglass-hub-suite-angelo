/**
 * PasswordChangeReminder — every Monday, nudges the user to change their
 * password shortly after logging in.
 *
 * Deliberately non-blocking: no full-screen backdrop, positioned as a small
 * floating card in the corner (same "doesn't cover the header" idea as
 * AnnouncementBanner, just a different corner so the two never collide).
 * The user can keep using the dashboards and the header's Time Clock
 * buttons the entire time this is showing — it's a nudge, not a gate.
 *
 * Dismissal (either "Change password" or "Remind me later"/✕) is remembered
 * per Firebase uid in localStorage, keyed by today's date, so it only nags
 * once per Monday and won't reappear again until the following Monday.
 */
import { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

function todayKey(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function dismissedStorageKey(uid: string): string {
  return `ahs:pwReminderDismissed:${uid}`;
}

export function PasswordChangeReminder() {
  const { ready, uid } = useAuth();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ready || !uid || typeof window === "undefined") return;
    // getDay(): 0 = Sunday, 1 = Monday.
    const isMonday = new Date().getDay() === 1;
    if (!isMonday) return;
    const dismissedOn = window.localStorage.getItem(dismissedStorageKey(uid));
    if (dismissedOn === todayKey()) return;
    setVisible(true);
  }, [ready, uid]);

  if (!visible || !uid) return null;

  const dismiss = () => {
    window.localStorage.setItem(dismissedStorageKey(uid), todayKey());
    setVisible(false);
  };

  const goChangePassword = () => {
    window.localStorage.setItem(dismissedStorageKey(uid), todayKey());
    setVisible(false);
    navigate({ to: "/profile" });
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 w-[min(92vw,23rem)]">
      <div className="rounded-2xl border border-blue-400/30 bg-slate-950/95 text-white shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="flex items-start gap-3 p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-blue-400/20 bg-blue-400/10 text-blue-200">
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200/80">Monday reminder</div>
            <div className="mt-0.5 text-sm font-semibold text-white">Time to change your password</div>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              For account security we recommend updating it weekly. This is just a reminder — you can keep working.
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={goChangePassword}
                className="rounded-full bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-600"
              >
                Change password
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
              >
                Remind me later
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
