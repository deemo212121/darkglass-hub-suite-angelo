import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronDown, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { todayStr, offsetStr } from "@/components/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LOCATIONS, mergeLocationOptions } from "@/lib/locations";
import { getCompanyUsers } from "@/lib/supabase/users";
import { getCompanyTickets, getTicketAuditLog, type TicketAuditEntry } from "@/lib/supabase/tickets";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const ACTION_LABELS: Record<string, string> = {
  status_change: "Status Change",
  reassign: "Technician Reassigned",
  reschedule: "Rescheduled",
};
const ACTIONS = Object.keys(ACTION_LABELS);

interface ActivityRow {
  id: string;
  ticketNo: string;
  location: string;
  user: string;
  action: string;
  field: string;
  before: string;
  after: string;
  date: string;
  time: string;
}

function toRows(entries: TicketAuditEntry[], userNames: Map<string, string>, ticketMeta: Map<string, { ticketNo: string; location: string }>): ActivityRow[] {
  return entries.map((e, i) => {
    const d = new Date(e.createdAt);
    const meta = ticketMeta.get(e.ticketId);
    return {
      id: `${e.ticketId}-${e.createdAt}-${e.field}-${i}`,
      ticketNo: meta?.ticketNo || "—",
      location: meta?.location || "",
      user: (e.changedBy && userNames.get(e.changedBy)) || "Unknown",
      action: e.action,
      field: e.field,
      before: e.beforeValue ?? "—",
      after: e.afterValue ?? "—",
      date: isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10),
      time: isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
  });
}

function MultiCheckDropdown({ label, options, labels, selected, onChange }: { label: string; options: string[]; labels?: Record<string, string>; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const all = selected.length === options.length;
  const display = all ? "All" : (selected.map((o) => labels?.[o] ?? o).join(", ") || "None");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label={`Select ${label}`} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2 text-left">
          <span className="truncate text-xs">{display}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(90vw,20rem)] sm:w-80 max-h-64 overflow-y-auto rounded-md border border-white/15 bg-slate-950 p-0 text-white shadow-xl">
        <label className="flex cursor-pointer items-center gap-2 border-b border-white/10 px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10">
          <input
            type="checkbox"
            checked={all}
            onChange={() => onChange(all ? [] : [...options])}
            className="accent-white"
            title={`Select all ${label.toLowerCase()}`}
          />
          Select All
        </label>
        {options.map(o => (
          <label key={o} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10">
            <input type="checkbox" checked={selected.includes(o)} onChange={() => onChange(selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o])} className="accent-white" title={labels?.[o] ?? o} />
            {labels?.[o] ?? o}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LocationDropdown({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label="Select location" className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2">
          <span className={value ? "" : "text-muted-foreground"}>{value || "All Locations"}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[min(90vw,16rem)] sm:w-64 max-h-64 overflow-y-auto rounded-md border border-white/15 bg-slate-950 p-0 text-white shadow-xl">
        <button onClick={() => { onChange(""); setOpen(false); }}
          className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${value === "" ? "bg-white/10 text-white" : "text-white/60"}`}>
          — All Locations —
        </button>
        {options.map((l, i) => (
          <button key={i} onClick={() => { onChange(l); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${value === l ? "bg-white/10 text-white" : "text-white/90"}`}>
            {l}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function DailyActivityReport({ mod, sub }: Props) {
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(offsetStr(1));
  const [actionFilter, setActionFilter] = useState<string[]>([...ACTIONS]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [locationOptions, setLocationOptions] = useState<string[]>(LOCATIONS as unknown as string[]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [profiles, tickets, auditLog] = await Promise.all([
          getCompanyUsers(),
          getCompanyTickets(),
          getTicketAuditLog({ startDate, endDate }),
        ]);
        if (cancelled) return;

        const userNames = new Map<string, string>();
        for (const p of profiles) userNames.set(p.id, p.display_name || p.username || p.email);

        const ticketMeta = new Map<string, { ticketNo: string; location: string }>();
        for (const t of tickets as any[]) {
          if (t._id) ticketMeta.set(t._id, { ticketNo: t.ticketNo, location: t.location });
        }

        setLocationOptions(mergeLocationOptions(LOCATIONS, tickets.map((t) => t.location)));
        setRows(toRows(auditLog, userNames, ticketMeta));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load activity report.");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (location && r.location !== location) return false;
      if (!actionFilter.includes(r.action)) return false;
      return true;
    });
  }, [rows, location, actionFilter]);

  return (
    <main className="max-w-350 mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground">🏠</Link><span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">Report</Link><span>›</span>
        <span className="text-foreground font-medium">Daily Activity Report</span>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
        <h1 className="text-xl font-bold">Daily Activity Report</h1>
      </div>

      <div className="panel mb-5 overflow-x-auto">
        <div className="flex min-w-max items-end gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</span>
            <LocationDropdown options={locationOptions} value={location} onChange={setLocation} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Work Date</span>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <label htmlFor="dar-start" className="sr-only">Start date</label>
              <input id="dar-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="Start date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32" />
              <span className="text-muted-foreground text-xs shrink-0">~</span>
              <label htmlFor="dar-end" className="sr-only">End date</label>
              <input id="dar-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="End date" placeholder="YYYY-MM-DD" className="glass-input text-sm py-1.5 px-2 rounded-md w-32" />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Action</span>
            <MultiCheckDropdown label="Action" options={ACTIONS} labels={ACTION_LABELS} selected={actionFilter} onChange={setActionFilter} />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      <div className="flex justify-end mb-2">
        <span className="text-sm text-muted-foreground">TOTAL # OF CHANGES: <span className="text-foreground font-bold text-lg">{filteredRows.length.toLocaleString()}</span></span>
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["#", "Ticket No", "User", "Location", "Action", "Field", "Before", "After", "Date", "Time"].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading activity…</td></tr>
            ) : filteredRows.length === 0
              ? <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No records found matching the selected filters.</td></tr>
              : filteredRows.map((r, idx) => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${idx % 2 !== 0 ? "bg-white/2" : ""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-mono text-blue-400">{r.ticketNo}</td>
                  <td className="px-3 py-2.5">{r.user}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.location || "—"}</td>
                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">{ACTION_LABELS[r.action] ?? r.action}</span></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.field || "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[160px] truncate" title={r.before}>{r.before}</td>
                  <td className="px-3 py-2.5 max-w-[160px] truncate" title={r.after}>{r.after}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.date}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.time}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
