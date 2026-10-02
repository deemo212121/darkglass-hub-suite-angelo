/**
 * HR → Clock-In Codes. The company's ONE 4-digit code for today (migration
 * 0344), made automatically when this page opens. Technicians, Branch
 * Managers, Senior Branch Managers and Technical (Assistant) Directors type
 * it to Time In; a Parts Manager can type it on Part Daily Pickup to clock
 * in a technician. Below: who used it today, and wrong tries.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Loader2, RefreshCw, Copy, Check, ChevronLeft, Pencil } from "lucide-react";
import { createPortal } from "react-dom";
import { ROLE_LABELS, ROLE_OPTIONS } from "@/lib/roleLabels";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import {
  ensureCompanyClockInCode,
  getClockInCodeEvents,
  regenerateCompanyClockInCode,
  getClockCodeViewerRoles,
  setClockCodeViewerRoles,
  CLOCK_CODE_ALWAYS_VIEWERS,
  type ClockInCodeEvent,
} from "@/lib/supabase/clockInCodes";

// Who must enter the code to Time In — same list as clock_in_code_required() (migration 0344):
// anyone holding one of these as primary or extra role, except Philippines staff.
const CODE_ROLES: { role: string; label: string }[] = [
  { role: "TECHNICIAN", label: "Technicians (incl. trainees)" },
  { role: "TECHNICIAN_MANAGER", label: "Technician Managers" },
  { role: "BRANCH_MANAGER", label: "Branch Managers" },
  { role: "SENIOR_BRANCH_MANAGER", label: "Senior Branch Managers" },
  { role: "TECHNICAL_ASSISTANT_DIRECTOR", label: "Technical Assistant Directors" },
  { role: "TECHNICAL_DIRECTOR", label: "Technical Directors" },
];

// Every 3 wrong entries count as 1 wrong try; 5 tries lock the person (migration 0345).
const ENTRIES_PER_TRY = 3;
const MAX_TRIES = 5;

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");

/** `standalone`: its own page (HR → Clock-In Codes tile) with a back button; otherwise embedded in the HR To Do List sidebar. */
export function ClockInCodesTab({ standalone, backModule = "hr" }: { standalone?: boolean; backModule?: string } = {}) {
  const navigate = useNavigate();
  // Branch leaders can see the code; only HR / Admin / SuperAdmin make a new one (migration 0346).
  const { role, extraRoles } = useAuth();
  const canRegenerate = [role, ...(extraRoles ?? [])].some((r) => ["HR", "ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"].includes(String(r || "").toUpperCase()));
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [code, setCode] = useState("");
  const [day, setDay] = useState("");
  const [codeSince, setCodeSince] = useState("");
  const [events, setEvents] = useState<ClockInCodeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // "Who can see this code" — extra roles besides HR / Admin / SuperAdmin (migration 0347).
  const [viewerRoles, setViewerRoles] = useState<string[]>([]);
  const [editViewersOpen, setEditViewersOpen] = useState(false);
  useEffect(() => {
    getClockCodeViewerRoles().then(setViewerRoles).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([getCompanyUsers(), ensureCompanyClockInCode()]);
      setProfiles(p);
      setCode(c.code);
      setDay(c.day);
      setCodeSince(c.createdAt);
      setEvents(await getClockInCodeEvents(c.day));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };
  // Once per page open (React can run effects twice in development).
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void load();
  }, []);

  const regenerate = async () => {
    if (!window.confirm("Make a new code for today? The current code stops working — everyone who hasn't clocked in yet will need the new one.")) return;
    setRegenerating(true);
    try {
      await regenerateCompanyClockInCode();
      await load();
    } catch (err) {
      alert(`Couldn't make a new code: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setRegenerating(false);
    }
  };

  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const nameOf = (id: string | null) => (id ? byId.get(id)?.display_name || byId.get(id)?.email || "?" : "—");
  const used = events.filter((e) => e.success);
  // Active, non-Philippines people per role (someone with two of these roles counts under each).
  const roleCounts = useMemo(() => {
    const held = (p: ProfileRow) => [p.role, ...(p.extra_roles ?? [])].map((r) => String(r || "").toUpperCase());
    const inScope = profiles.filter((p) => p.is_active && (p.assigned_branch || "").trim().toLowerCase() !== "philippines");
    const counts = new Map(CODE_ROLES.map((r) => [r.role, inScope.filter((p) => held(p).includes(r.role)).length]));
    const total = inScope.filter((p) => held(p).some((r) => CODE_ROLES.some((c) => c.role === r))).length;
    return { counts, total };
  }, [profiles]);
  // Wrong tries against the CURRENT code, per person. Every 3 wrong entries count as 1 try;
  // 5 tries (15 wrong entries) lock that person until a new code (migration 0345).
  const wrongByPerson = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) if (!e.success && (!codeSince || e.createdAt >= codeSince)) m.set(e.profileId, (m.get(e.profileId) ?? 0) + 1);
    return [...m.entries()]
      .map(([id, entries]) => ({ id, entries, tries: Math.floor(entries / ENTRIES_PER_TRY) }))
      .filter((x) => x.tries >= 1)
      .sort((a, b) => b.entries - a.entries);
  }, [events, codeSince]);

  const dayLabel = day ? new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";

  return (
    <div className={standalone ? "max-w-[1100px] mx-auto px-6 py-8 space-y-4" : "space-y-4"}>
      {standalone && (
        <button
          type="button"
          onClick={() => navigate({ to: "/m/$module", params: { module: backModule } })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> {backModule === "hr" ? "HR" : "Back"}
        </button>
      )}

      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <KeyRound className="h-5 w-5 text-blue-400" />
          <h2 className="text-lg font-bold">Clock-In Code</h2>
          <div className="ml-auto flex items-center gap-1.5">
            {canRegenerate && (
              <button type="button" onClick={() => setEditViewersOpen(true)} className="btn text-xs px-2 py-1 inline-flex items-center gap-1" title="Choose which roles can see this code">
                <Pencil className="h-3.5 w-3.5" /> Who can see this code
              </button>
            )}
            <button type="button" onClick={() => void load()} className="btn text-xs px-2 py-1 inline-flex items-center gap-1">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-1">
          <span className="font-semibold text-slate-300">Can see this code:</span>{" "}
          {[...CLOCK_CODE_ALWAYS_VIEWERS, ...viewerRoles.filter((r) => !(CLOCK_CODE_ALWAYS_VIEWERS as readonly string[]).includes(r))]
            .map((r) => ROLE_LABELS[r] ?? r)
            .join(", ")}
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          One code for the whole company, new every day. Technicians, Branch Managers, Senior Branch Managers and Technical (Assistant)
          Directors enter it to Time In. A Parts Manager can also use it on Part Daily Pickup to clock in a technician.
        </p>

        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Who needs this code</div>
          <ul className="space-y-1.5 text-sm">
            {CODE_ROLES.map((r) => (
              <li key={r.role} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                <span className="flex-1">{r.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{roleCounts.counts.get(r.role) ?? 0}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-white/10 pt-2 text-xs text-muted-foreground">
            <span className="tabular-nums font-semibold text-slate-200">{roleCounts.total}</span> people in total · Primary or extra role ·
            Philippines staff don't need it
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-white/[0.02] py-8 text-center">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{dayLabel || "Today"}</div>
          {loading && !code ? (
            <Loader2 className="h-6 w-6 animate-spin mt-4 text-slate-400" />
          ) : (
            <div className="mt-2 font-mono text-6xl font-bold tracking-[0.3em] tabular-nums text-white">{code || "—"}</div>
          )}
          {codeSince && <div className="mt-2 text-xs text-muted-foreground">Since {fmtTime(codeSince)}</div>}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              disabled={!code}
              onClick={() => {
                void navigator.clipboard?.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="btn text-sm px-4 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
            </button>
            {canRegenerate && (
              <button type="button" onClick={() => void regenerate()} disabled={regenerating || loading} className="btn text-sm px-4 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-40">
                {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} New code
              </button>
            )}
          </div>
          {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        </div>
        </div>
      </div>

      {editViewersOpen && (
        <ViewerRolesModal
          initial={viewerRoles}
          onClose={() => setEditViewersOpen(false)}
          onSaved={(roles) => {
            setViewerRoles(roles);
            setEditViewersOpen(false);
          }}
        />
      )}

      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="panel p-0">
          <div className="px-4 py-3 border-b border-white/10 text-sm font-semibold">Clocked in with the code today ({used.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Branch</th>
                  <th className="px-3 py-2">Entered by</th>
                </tr>
              </thead>
              <tbody>
                {used.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No one yet today.</td>
                  </tr>
                )}
                {used.map((e) => (
                  <tr key={e.id} className="border-b border-white/5">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtTime(e.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{nameOf(e.profileId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{byId.get(e.profileId)?.assigned_branch || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{e.enteredBy === e.profileId ? "Themselves" : nameOf(e.enteredBy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel p-0">
          <div className="px-4 py-3 border-b border-white/10 text-sm font-semibold">Wrong tries (current code)</div>
          <div className="p-3 space-y-1.5 text-xs">
            {wrongByPerson.length === 0 && <div className="text-muted-foreground">None.</div>}
            {wrongByPerson.map(({ id, entries, tries }) => (
              <div key={id} className="flex items-center justify-between gap-2">
                <span className="truncate">{nameOf(id)}</span>
                <span
                  title={`${entries} wrong entries (every ${ENTRIES_PER_TRY} = 1 try)`}
                  className={`shrink-0 rounded border px-1.5 py-0.5 ${tries >= MAX_TRIES ? "bg-red-500/15 text-red-300 border-red-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30"}`}
                >
                  {tries >= MAX_TRIES ? `Locked — ${MAX_TRIES} tries` : `${tries} ${tries === 1 ? "try" : "tries"}`}
                </span>
              </div>
            ))}
            <p className="pt-1 text-muted-foreground">
              Every {ENTRIES_PER_TRY} wrong entries count as 1 try. {MAX_TRIES} tries lock that person until you make a new code.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Checklist of roles that can see the code. HR / Admin / SuperAdmin are always on. */
function ViewerRolesModal({ initial, onClose, onSaved }: { initial: string[]; onClose: () => void; onSaved: (roles: string[]) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const always = CLOCK_CODE_ALWAYS_VIEWERS as readonly string[];
  const options = ROLE_OPTIONS.filter((o) => !always.includes(o.value) && (!search.trim() || o.label.toLowerCase().includes(search.trim().toLowerCase())));

  const toggle = (role: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const roles = [...picked].filter((r) => !always.includes(r));
      await setClockCodeViewerRoles(roles);
      onSaved(roles);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-md p-5 shadow-2xl flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-white">Who can see this code</h2>
        <p className="text-xs text-slate-400 mt-0.5 mb-3">HR, Admin and SuperAdmin always can. Tick any other roles that should see today's code (primary or extra role).</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {always.map((r) => (
            <span key={r} className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">✓ {ROLE_LABELS[r] ?? r}</span>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search roles" className="glass-input text-sm py-1.5 px-3 rounded-md mb-2" />
        <div className="flex-1 overflow-y-auto rounded-md border border-white/10 divide-y divide-white/5">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-white/5">
              <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o.value)} className="accent-blue-500" />
              {o.label}
            </label>
          ))}
          {options.length === 0 && <div className="px-3 py-3 text-xs text-slate-500">No roles match.</div>}
        </div>
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">{picked.size} selected</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="btn text-sm px-3 py-1.5">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={saving} className="btn text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
