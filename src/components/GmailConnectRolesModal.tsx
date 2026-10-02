/**
 * Settings popup (Admin/SuperAdmin only) for which roles may Connect /
 * Disconnect one Gmail slot — e.g. the ticket page's Parts/Drop-Ship Gmail.
 * Admin/SuperAdmin always can; this grants extra roles (migration 0329).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { ROLE_OPTIONS } from "@/lib/roleLabels";
import { getGmailConnectRoles, setGmailConnectRoles, type GmailRegion } from "@/lib/supabase/gmailConnection";

export function GmailConnectRolesModal({
  region,
  title,
  onClose,
  onSaved,
}: {
  region: GmailRegion;
  title: string;
  onClose: () => void;
  onSaved?: (roles: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    getGmailConnectRoles(region)
      .then((roles) => !cancelled && setSelected(new Set(roles)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [region]);

  // Admin is always allowed, so it isn't offered as a choice.
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ROLE_OPTIONS.filter((o) => o.value !== "ADMIN" && (!q || o.label.toLowerCase().includes(q)));
  }, [search]);

  const toggle = (role: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const roles = [...selected];
      await setGmailConnectRoles(region, roles);
      onSaved?.(roles);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-lg w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <div className="text-sm font-bold text-white">{title}</div>
            <div className="text-[11px] text-slate-400">Who can connect / disconnect this Gmail. Admins always can.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-7 h-7 rounded hover:bg-white/10 inline-flex items-center justify-center text-slate-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 pt-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles…"
            className="w-full rounded border border-white/15 bg-slate-950 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="overflow-auto px-4 py-2 flex-1">
          {loading ? (
            <div className="py-8 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
              {options.map((o) => (
                <label key={o.value} className="flex items-center gap-2 py-1 text-sm text-slate-200 cursor-pointer">
                  <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">{selected.size} role{selected.size === 1 ? "" : "s"} granted</span>
          <div className="flex items-center gap-2">
            {error && <span className="text-[11px] text-rose-300">{error}</span>}
            <button type="button" onClick={onClose} className="rounded border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving || loading} className="rounded bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
