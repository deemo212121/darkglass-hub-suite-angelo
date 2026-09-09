/**
 * "Your account is frozen" pop-up — shown to a frozen technician on both
 * desktop (mounted once in __root.tsx, gated !hideChrome so it doesn't
 * show on /mobile, /landing, etc.) and mobile (mounted in MobileTechApp.tsx,
 * which already has its own isFrozen from useAuth() so it's passed down
 * there instead of read again).
 * Lists exactly which Technician-tab forms are still outstanding, via
 * technicianFormStatus.ts (same signed/confirmed = done + exemption rules
 * as TechnicianFormChecklistPage.tsx, just scoped to this one profile) —
 * same "please complete your forms" nudge as the desktop/mobile restriction
 * panels, but with the actual punch list instead of a generic message.
 * Dismissible for the session (stays mounted at the root, so it won't
 * reappear on every in-app navigation — only on a fresh page load).
 */
import { useEffect, useState } from "react";
import { Snowflake, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getMyIncompleteTechForms, type IncompleteTechForm } from "@/lib/technicianFormStatus";
import { SIGNABLE_DOCUMENT_REGISTRY } from "@/lib/signableDocumentRegistry";
import { getAppUrl } from "@/lib/appUrl";

export function FrozenAccountModal() {
  const { uid, isFrozen } = useAuth();
  const [forms, setForms] = useState<IncompleteTechForm[] | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!uid || !isFrozen) return;
    let cancelled = false;
    getMyProfileId(uid)
      .then((profileId) => (profileId ? getMyIncompleteTechForms(profileId) : Promise.resolve([])))
      .then((list) => { if (!cancelled) setForms(list); })
      .catch((err) => {
        console.error("FrozenAccountModal: failed to load incomplete forms", err);
        if (!cancelled) setForms([]);
      });
    return () => { cancelled = true; };
  }, [uid, isFrozen]);

  if (!isFrozen || !open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-sky-500/30 bg-slate-950 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-300">
            <Snowflake className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-white">Your account is frozen</h2>
            <p className="mt-1 text-sm leading-5 text-slate-400">
              To unfreeze your account, please complete the forms below. You can still use Messages to reach HR. Contact them if you have questions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="shrink-0 rounded-full p-1 text-slate-500 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-slate-900/50">
          {forms === null ? (
            <p className="px-3 py-4 text-center text-xs text-slate-500">Loading…</p>
          ) : forms.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-slate-500">No forms are currently outstanding — reach out to HR in Messages to get unfrozen.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {forms.map((f) => {
                const fillHref = f.pending && f.docId ? `${getAppUrl()}${SIGNABLE_DOCUMENT_REGISTRY[f.type]?.internalPath ?? ""}/${f.docId}` : null;
                return (
                  <li key={f.type} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-200">{f.label}</span>
                    {fillHref ? (
                      <a
                        href={fillHref}
                        className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300 hover:bg-amber-500/20"
                      >
                        Fill now
                      </a>
                    ) : (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Not sent yet</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 w-full rounded-lg border border-sky-500/40 bg-sky-500/15 py-2 text-sm font-semibold text-sky-300 hover:bg-sky-500/25"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
