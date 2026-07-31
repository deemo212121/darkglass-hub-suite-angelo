import { useState } from "react";
import { History } from "lucide-react";
import {
  getModuleActivityLog,
  moduleActivityActionLabel,
  type ActivityLogModule,
  type ModuleActivityLogEntry,
} from "@/lib/supabase/moduleActivityLog";

/**
 * Toggle button that pops the log open in a modal — embedded directly
 * inside an already role-gated dashboard page, so access control is the
 * page's own (DASHBOARD_ROLE_GATES / ADMIN_MODULE_ROLES in
 * m.$module.$submodule.tsx), not this component's: whoever can see the
 * page can see its log and no one else can.
 */
export function ActivityLogPanel({ module, title = "Activity Log" }: { module: ActivityLogModule; title?: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<ModuleActivityLogEntry[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      setEntries(await getModuleActivityLog(module));
      setLoaded(true);
    } catch (err) {
      console.error(`Failed to load ${module} activity log:`, err);
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    setOpen(true);
    if (!loaded) load();
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-semibold transition flex items-center gap-2 text-sm"
      >
        <History className="h-4 w-4" />
        {title}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <History className="h-4 w-4" />
                {title}
                {loaded ? ` (${entries.length})` : ""}
              </h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white transition p-1">
                ✕
              </button>
            </div>

            {loading ? (
              <p className="text-slate-500 text-sm">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="text-slate-500 text-sm">No activity yet.</p>
            ) : (
              <div className="space-y-2">
                {entries.map((e) => (
                  <div key={e.id} className="bg-slate-800/50 rounded p-3 border border-white/5">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <p className="text-xs font-semibold text-white">
                          {moduleActivityActionLabel(e.action)}
                          {e.targetLabel ? ` — ${e.targetLabel}` : ""}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">{e.actorName || "System"}</p>
                        {typeof e.details?.note === "string" && e.details.note && (
                          <p className="text-xs text-slate-400 mt-0.5">{e.details.note}</p>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 shrink-0">{new Date(e.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
