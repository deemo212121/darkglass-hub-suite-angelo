/**
 * Persistent strip shown while a Super Admin is previewing the app as
 * another role (see auth.tsx's viewAsRole) — a front-end-only nav/module
 * preview, not a real permission change (Supabase RLS still authorizes
 * everything against the real account). This banner exists so that fact
 * never gets lost mid-session: it's the one place that constantly reminds
 * the admin they're looking at a simulation and gives them a one-click way
 * out of it.
 */
import { Eye, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roleLabels";

export function ViewAsRoleBanner() {
  const { viewAsRole, setViewAsRole } = useAuth();

  if (!viewAsRole) return null;

  const label = ROLE_LABELS[viewAsRole] ?? viewAsRole;

  return (
    <div className="fixed inset-x-0 top-0 z-[90] flex justify-center px-4 pt-3 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-violet-400/40 bg-violet-950/95 pl-3.5 pr-2 py-1.5 text-xs font-medium text-violet-100 shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <Eye className="h-3.5 w-3.5 shrink-0 text-violet-300" />
        <span>
          Viewing as <span className="font-semibold text-white">{label}</span> — preview only, your actions still use your real access
        </span>
        <button
          type="button"
          onClick={() => setViewAsRole(null)}
          className="flex items-center gap-1 rounded-full border border-violet-300/30 bg-white/10 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-white/20"
        >
          <X className="h-3 w-3" /> Exit
        </button>
      </div>
    </div>
  );
}
