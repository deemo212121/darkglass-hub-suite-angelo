/**
 * The Terms & Conditions window (migration 0455) — shown over the whole app
 * to a signed-in person who still has terms to accept. It can't be closed:
 * scroll to the end, tick "I have read and agree", then I agree. Decline
 * signs out. Several sets are shown one after another.
 *
 * Checked when the app opens, when the tab comes back into focus, and every
 * 5 minutes — so people already signed in get newly published terms within
 * minutes, without being signed out. If the check can't run (migration not
 * run yet, offline) nothing is shown, so nobody is locked out by mistake.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { FileCheck2, Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { acceptTerms, getMyPendingTerms } from "@/lib/supabase/terms";
import { getMyProfileId } from "@/lib/supabase/users";
import type { PendingTerms } from "@/lib/terms";
import { TERMS_DOC_CLASS, TERMS_DOC_PANEL, TermsDocStyleTag } from "@/components/TermsDocStyle";

const CHECK_EVERY_MS = 5 * 60 * 1000;
/** Don't re-check on every focus — at most this often. */
const FOCUS_GAP_MS = 60 * 1000;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function TermsGate({ device = "web" }: { device?: "web" | "mobile" }) {
  const { uid, ready, logout, mustChangePassword, displayName, email } = useAuth();
  const [pending, setPending] = useState<PendingTerms[]>([]);
  /** Shown in "Recorded by the System" (the account/user ID). */
  const [profileId, setProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid || !pending.length || profileId) return;
    getMyProfileId(uid).then(setProfileId).catch(() => {});
  }, [uid, pending.length, profileId]);
  const lastCheck = useRef(0);

  const check = useCallback(() => {
    if (!uid) return;
    lastCheck.current = Date.now();
    getMyPendingTerms().then((list) => { if (list) setPending(list); });
  }, [uid]);

  useEffect(() => {
    if (!ready || !uid) { setPending([]); return; }
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onFocus = () => { if (Date.now() - lastCheck.current > FOCUS_GAP_MS) check(); };
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, uid, check]);

  // A forced password change comes first (it sends people to /profile) — the terms follow right after.
  if (!pending.length || mustChangePassword) return null;
  const current = pending[0];
  return (
    <TermsWindow
      key={current.versionId}
      terms={current}
      step={{ at: 1, of: pending.length }}
      who={{ name: displayName || "", email: email || "", id: profileId || uid || "" }}
      onAccept={async () => {
        await acceptTerms(current.versionId, device);
        setPending((p) => p.filter((t) => t.versionId !== current.versionId));
      }}
      onDecline={() => { void logout(); }}
    />
  );
}

function TermsWindow({
  terms,
  step,
  who,
  onAccept,
  onDecline,
}: {
  terms: PendingTerms;
  step: { at: number; of: number };
  who: { name: string; email: string; id: string };
  onAccept: () => Promise<void>;
  onDecline: () => void;
}) {
  const [readToEnd, setReadToEnd] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const checkEnd = () => {
    const el = scrollRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReadToEnd(true);
  };
  // Short terms that fit without scrolling count as read.
  useEffect(() => { const t = window.setTimeout(checkEnd, 50); return () => window.clearTimeout(t); }, []);

  const html = DOMPurify.sanitize(terms.body);

  const accept = async () => {
    if (!agreed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onAccept();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6">
      <TermsDocStyleTag />
      <div role="dialog" aria-modal="true" aria-labelledby="terms-title" className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-sky-300">
            <FileCheck2 className="h-3.5 w-3.5" />
            Please read and accept to continue
            {step.of > 1 && <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-slate-300">{step.at} of {step.of}</span>}
          </div>
          <h2 id="terms-title" className="mt-1.5 text-xl font-bold text-white" style={{ textWrap: "balance" }}>{terms.title}</h2>
          <p className="mt-0.5 text-xs text-slate-400">Version {terms.version} · effective {fmtDate(terms.publishedAt)}</p>
        </div>

        <div ref={scrollRef} onScroll={checkEnd} className={`min-h-[12rem] flex-1 overflow-y-auto ${TERMS_DOC_PANEL} px-6 py-7 sm:px-12 sm:py-9`}>
          <div className={`${TERMS_DOC_CLASS} mx-auto max-w-[72ch]`} dangerouslySetInnerHTML={{ __html: html }} />
          {/* What the System records on accepting — the real values, not placeholders. */}
          <div className="mx-auto mt-8 max-w-[72ch] terms-info rounded-lg px-5 py-4 text-[13px]">
            <div className="mb-2 terms-info-title text-[11px] font-bold uppercase tracking-wider">User information (recorded by the System)</div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
              <dt className="font-semibold text-slate-100">Full Name</dt><dd className="truncate">{who.name || "—"}</dd>
              <dt className="font-semibold text-slate-100">Company Email</dt><dd className="truncate">{who.email || "—"}</dd>
              <dt className="font-semibold text-slate-100">Account / User ID</dt><dd className="truncate font-mono text-[12px]">{who.id || "—"}</dd>
              <dt className="font-semibold text-slate-100">Acceptance Date and Time</dt><dd>Recorded when you press I agree</dd>
              <dt className="font-semibold text-slate-100">IP Address and Approximate Location</dt><dd>Recorded when you press I agree</dd>
              <dt className="font-semibold text-slate-100">Agreement Version</dt><dd>Version {terms.version}</dd>
            </dl>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 px-5 py-4 sm:px-6">
          {!readToEnd && <p className="text-xs text-amber-300">Scroll to the end of the terms to continue.</p>}
          <label className={`flex items-start gap-2.5 text-sm ${readToEnd ? "cursor-pointer text-slate-200" : "cursor-not-allowed text-slate-500"}`}>
            <input
              type="checkbox"
              checked={agreed}
              disabled={!readToEnd}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-sky-500"
            />
            I have read, understood, and agree to the {terms.title}.
          </label>
          {error && <p className="text-xs text-red-300">{error}</p>}
          {confirmDecline ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              You can't use the system without accepting. Sign out?
              <button type="button" onClick={onDecline} className="ml-auto rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700">Sign out</button>
              <button type="button" onClick={() => setConfirmDecline(false)} className="rounded-md bg-slate-700 px-3 py-1.5 font-semibold text-white hover:bg-slate-600">Go back</button>
            </div>
          ) : (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmDecline(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 hover:text-white">
                <LogOut className="h-4 w-4" /> Decline
              </button>
              <button
                type="button"
                onClick={() => void accept()}
                disabled={!agreed || saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} I agree
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
