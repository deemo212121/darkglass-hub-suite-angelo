import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import { getCompanyUsers } from "@/lib/supabase/users";
import { getReservedPartRows, TERMINAL_TICKET_STATUSES, type ReservedPartRow } from "@/lib/supabase/reservedPartList";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

const DS: React.CSSProperties = { background: "var(--color-card)", color: "var(--color-foreground)", border: "1px solid var(--color-panel-border)", borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 999999, position: "fixed", maxHeight: 260, overflowY: "auto" };
const Chev = ({ o }: { o: boolean }) => <svg className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${o ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>;
function useP(open: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<any>(null);
  const r = useCallback(() => { if (!ref.current) return; const b = ref.current.getBoundingClientRect(); setPos({ top: b.bottom + 2, left: b.left, width: b.width }); }, []);
  useLayoutEffect(() => { if (open) r(); }, [open, r]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", r, true); window.addEventListener("resize", r);
    return () => { window.removeEventListener("scroll", r, true); window.removeEventListener("resize", r); };
  }, [open, r]);
  return { ref, pos };
}

export function ReservedPartList({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [allRows, setAllRows] = useState<ReservedPartRow[]>([]);
  const [technicianRoster, setTechnicianRoster] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [location, setLocation] = useState(""); const [locOpen, setLocOpen] = useState(false);
  const [tech, setTech] = useState(""); const [techOpen, setTechOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [partNo, setPartNo] = useState(""); const [invoiceNo, setInvoiceNo] = useState("");
  const [showAllStatus, setShowAllStatus] = useState(false);
  const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const locD = useP(locOpen); const techD = useP(techOpen); const locL = useRef<HTMLDivElement>(null); const techL = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const loadRows = () => {
    setLoading(true);
    setLoadError(null);
    getReservedPartRows()
      .then(setAllRows)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRows();
    // Real technician roster (active TECHNICIAN/TECHNICIAN_MANAGER users),
    // same source used on Part Daily Pickup, instead of the static
    // ALL_TECHNICIANS seed list - so the filter only offers names that can
    // actually match a real ticket.technician value.
    getCompanyUsers().then((users) => {
      const names = users
        .filter((u) => {
          const roles = [u.role, ...(u.extra_roles ?? [])].map((r) => (r || "").toUpperCase());
          return u.is_active && (roles.includes("TECHNICIAN") || roles.includes("TECHNICIAN_MANAGER"));
        })
        .map((u) => u.display_name || u.email)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setTechnicianRoster(names);
    }).catch((err) => console.error("Failed to load technician roster:", err));
  }, []);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const t = e.target as Node;
      if (locOpen && !locD.ref.current?.contains(t) && !locL.current?.contains(t)) setLocOpen(false);
      if (techOpen && !techD.ref.current?.contains(t) && !techL.current?.contains(t)) setTechOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [locOpen, techOpen]);

  const rows = useMemo(() => {
    let r = allRows;
    if (!showAllStatus) r = r.filter((x) => !TERMINAL_TICKET_STATUSES.includes(x.ticketStatus));
    else if (startDate || endDate) {
      r = r.filter((x) => {
        if (!TERMINAL_TICKET_STATUSES.includes(x.ticketStatus)) return true;
        const changed = x.statusChangedAt ? x.statusChangedAt.slice(0, 10) : "";
        if (!changed) return false;
        if (startDate && changed < startDate) return false;
        if (endDate && changed > endDate) return false;
        return true;
      });
    }
    if (location) r = r.filter((x) => x.location === location);
    if (tech) r = r.filter((x) => x.technician === tech);
    if (scheduleDate) r = r.filter((x) => x.scheduleDate === scheduleDate);
    if (partNo) r = r.filter((x) => x.partNo.toLowerCase().includes(partNo.toLowerCase()));
    if (invoiceNo) r = r.filter((x) => x.invoiceNo.toLowerCase().includes(invoiceNo.toLowerCase()));
    if (resultSearch) {
      const s = resultSearch.toLowerCase();
      r = r.filter((x) => [x.location, x.ticketNo, x.ticketStatus, x.technician, x.modelCode, x.partNo, x.description, x.id, x.partStatus].join(" ").toLowerCase().includes(s));
    }
    return r;
  }, [allRows, endDate, invoiceNo, location, partNo, resultSearch, scheduleDate, showAllStatus, startDate, tech]);

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>
        <div className="panel mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</label>
              <button ref={locD.ref} onClick={() => setLocOpen((o) => !o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={location ? "" : "text-muted-foreground"}>{location || "All"}</span><Chev o={locOpen} /></button>
              {locOpen && locD.pos && createPortal(
                <div ref={locL} style={{ ...DS, top: locD.pos.top, left: locD.pos.left, width: locD.pos.width }}>
                  <button onClick={() => { setLocation(""); setLocOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location === "" ? "bg-blue-600 text-white" : "text-slate-400"}`}>— All —</button>
                  {LOCATIONS.map((l, i) => <button key={i} onClick={() => { setLocation(l); setLocOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${location === l ? "bg-blue-600 text-white" : ""}`}>{l}</button>)}
                </div>, document.body,
              )}
            </div>
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Technician</label>
              <button ref={techD.ref} onClick={() => setTechOpen((o) => !o)} className="glass-input w-full text-sm py-1.5 px-3 rounded-md flex items-center justify-between gap-2"><span className={tech ? "" : "text-muted-foreground"}>{tech || "All"}</span><Chev o={techOpen} /></button>
              {techOpen && techD.pos && createPortal(
                <div ref={techL} style={{ ...DS, top: techD.pos.top, left: techD.pos.left, width: techD.pos.width }}>
                  <button onClick={() => { setTech(""); setTechOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech === "" ? "bg-blue-600 text-white" : "text-slate-400"}`}>— All —</button>
                  {technicianRoster.map((t, i) => <button key={i} onClick={() => { setTech(t); setTechOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${tech === t ? "bg-blue-600 text-white" : ""}`}>{t}</button>)}
                </div>, document.body,
              )}
            </div>
            <div className="flex items-end gap-3 pb-0.5">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Schedule Date</label>
                <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md" />
              </div>
              <button type="button" onClick={loadRows} className="btn px-4 py-1.5 h-[34px]">Refresh</button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 mt-3">
            <div className="flex flex-col gap-1 flex-1 min-w-[140px]"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Part #</label><input value={partNo} onChange={(e) => setPartNo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
            <div className="flex flex-col gap-1 flex-1 min-w-[160px]"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Invoice #</label><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" /></div>
            <div className="flex items-end gap-3 pb-0.5">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={showAllStatus} onChange={(e) => setShowAllStatus(e.target.checked)} className="accent-blue-500" />Show All Repair Status (Cancel/Complete Date)</label>
              {showAllStatus && <>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
                <span className="text-muted-foreground text-xs">~</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="glass-input text-sm py-1.5 px-2 rounded-md w-32.5" />
              </>}
            </div>
          </div>
        </div>

        {loadError ? (
          <p className="text-sm text-red-400 px-2 py-6">Failed to load reserved parts: {loadError}</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground px-2 py-6">Loading…</p>
        ) : (
        <>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span><span className="text-foreground font-medium">{rows.length}</span> records found</span>
          <input type="text" value={resultSearch} onChange={(e) => setResultSearch(e.target.value)} placeholder="search in result" className="glass-input text-sm py-1.5 px-3 rounded-md w-64" />
        </div>
        <div ref={tableScrollRef} className="panel overflow-x-auto p-0">
          <table className="w-full min-w-max text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              {["#", "Location", "Ticket No", "Repair Status", "Technician", "Schedule Date", "Model Code", "Part No", "Description", "Unique ID", "Qty", "Received", "Part Status"].map((h) => <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-8 text-center text-muted-foreground">No records found.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 !== 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-3 py-2.5 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2.5 text-xs">{r.location || "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {r.ticketNo ? <Link to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline">{r.ticketNo}</Link> : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{r.ticketStatus || "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{r.technician || "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.scheduleDate || "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{r.modelCode || "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.partNo}</td>
                  <td className="px-3 py-2.5 text-xs">{r.description || "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-[10px]" title={r.id}>{r.id.slice(0, 8)}</td>
                  <td className="px-3 py-2.5 text-right">{r.quantity}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.receivedDate || "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{r.partStatus || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
        </>
        )}
      </main>
    </div>
  );
}
