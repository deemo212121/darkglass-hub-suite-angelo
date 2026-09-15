import { useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * The modal is portaled to document.body — some callers (e.g.
 * AdminUserManagementPage.tsx) render this button inside a
 * `backdrop-blur-*` panel, and `backdrop-filter` on an ancestor creates a
 * new containing block for `position: fixed` descendants, same as
 * `transform`/`filter`/`perspective`. Without the portal the "fixed"
 * overlay gets trapped inside that panel's box instead of covering the
 * real viewport.
 */
export function ActivityLogPanel({ module, title = "Activity Log" }: { module: ActivityLogModule; title?: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<ModuleActivityLogEntry[]>([]);
  // Client-side — the up-to-200 entries already loaded per open, same as
  // the rest of this panel; no separate query per filter change.
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filteredEntries = entries.filter((e) => {
    const day = e.createdAt.slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (e.actorName || "").toLowerCase().includes(q) ||
      (e.targetLabel || "").toLowerCase().includes(q) ||
      moduleActivityActionLabel(e.action).toLowerCase().includes(q)
    );
  });
  const hasFilters = search.trim() !== "" || dateFrom !== "" || dateTo !== "";

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

      {open &&
        createPortal(
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
                  {loaded ? ` (${hasFilters ? `${filteredEntries.length} of ${entries.length}` : entries.length})` : ""}
                </h3>
                <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white transition p-1">
                  ✕
                </button>
              </div>

              {loaded && entries.length > 0 && (
                <div className="flex flex-wrap items-end gap-2 mb-4 pb-4 border-b border-white/10">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Search</label>
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Who or what…"
                      className="rounded-lg border border-white/15 bg-slate-800 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 w-40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">From</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="rounded-lg border border-white/15 bg-slate-800 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">To</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="rounded-lg border border-white/15 bg-slate-800 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  {hasFilters && (
                    <button
                      type="button"
                      onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}
                      className="text-xs text-blue-400 hover:text-blue-300 mb-1.5"
                    >
                      Reset filters
                    </button>
                  )}
                </div>
              )}

              {loading ? (
                <p className="text-slate-500 text-sm">Loading…</p>
              ) : entries.length === 0 ? (
                <p className="text-slate-500 text-sm">No activity yet.</p>
              ) : filteredEntries.length === 0 ? (
                <p className="text-slate-500 text-sm">No activity matches that filter.</p>
              ) : (
                <div className="space-y-2">
                  {filteredEntries.map((e) => (
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
          </div>,
          document.body
        )}
    </>
  );
}
