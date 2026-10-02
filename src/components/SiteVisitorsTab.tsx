import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getSiteVisits, type SiteVisit } from "@/lib/supabase/siteVisits";
import type { LoginEvent } from "@/lib/supabase/loginEvents";
import type { ProfileRow } from "@/lib/supabase/users";

interface Props {
  /** Login history, to name visitors whose IP an employee has signed in from. */
  loginEvents: LoginEvent[];
  profiles: ProfileRow[];
}

const RANGE_OPTIONS = [
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
] as const;

/** Login Security → Site Visitors: every page open on the site, signed in or not (migration 0340). */
export function SiteVisitorsTab({ loginEvents, profiles }: Props) {
  const [days, setDays] = useState<number>(7);
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [unknownOnly, setUnknownOnly] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setVisits(await getSiteVisits(days));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(/site_visits/.test(msg) ? "Site visitor logging isn't set up yet — run migration 0340 in Supabase." : msg);
      setVisits([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  // IP → employees who have signed in from it (from Login Security's own history).
  const employeesByIp = useMemo(() => {
    const nameById = new Map(profiles.map((p) => [p.id, p.display_name || p.email || "Unknown"]));
    const map = new Map<string, Set<string>>();
    for (const e of loginEvents) {
      if (!e.ip) continue;
      const name = nameById.get(e.profileId);
      if (!name) continue;
      if (!map.has(e.ip)) map.set(e.ip, new Set());
      map.get(e.ip)!.add(name);
    }
    return map;
  }, [loginEvents, profiles]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visits.filter((v) => {
      const known = v.ip ? employeesByIp.get(v.ip) : undefined;
      if (unknownOnly && known && known.size > 0) return false;
      if (!q) return true;
      return [v.ip, v.city, v.region, v.country, v.asOrg, v.path, v.browser, v.device, ...(known ? [...known] : [])]
        .some((s) => s && s.toLowerCase().includes(q));
    });
  }, [visits, search, unknownOnly, employeesByIp]);

  const uniqueIps = useMemo(() => new Set(rows.map((r) => r.ip).filter(Boolean)).size, [rows]);
  const unknownIps = useMemo(
    () => new Set(rows.filter((r) => r.ip && !employeesByIp.get(r.ip)?.size).map((r) => r.ip)).size,
    [rows, employeesByIp],
  );

  const location = (v: SiteVisit) => [v.city, v.region, v.country].filter(Boolean).join(", ") || "—";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <span className="text-sm text-muted-foreground">
          <span className="text-foreground font-medium">{rows.length}</span> page opens ·{" "}
          <span className="text-foreground font-medium">{uniqueIps}</span> IPs ·{" "}
          <span className="text-amber-300 font-medium">{unknownIps}</span> not matched to an employee
          {loading ? " · loading…" : null}
          {error ? <span className="text-red-300 ml-3">⚠ {error}</span> : null}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={unknownOnly} onChange={(e) => setUnknownOnly(e.target.checked)} />
            Unknown visitors only
          </label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="glass-input text-xs py-1 px-2 rounded-md">
            {RANGE_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>{o.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="IP, city, page, name…"
            className="glass-input text-xs py-1 px-2 rounded-md w-52"
          />
          <button type="button" onClick={() => void load()} disabled={loading} className="btn text-xs px-2 py-1" title="Reload visitors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              {["Time", "IP", "Location", "Network", "Page", "Browser / Device", "Came From", "Employee on this IP"].map((h) => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                  {loading ? "Loading…" : error ? "—" : "No visits recorded in this range yet."}
                </td>
              </tr>
            ) : (
              rows.map((v) => {
                const known = v.ip ? [...(employeesByIp.get(v.ip) ?? [])] : [];
                return (
                  <tr key={v.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{new Date(v.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2.5 font-mono whitespace-nowrap">{v.ip ?? "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{location(v)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap max-w-[14rem] truncate" title={v.asOrg ?? ""}>{v.asOrg ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono whitespace-nowrap max-w-[16rem] truncate" title={v.path ?? ""}>{v.path ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{[v.browser, v.device].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap max-w-[14rem] truncate" title={v.referer ?? ""}>{v.referer ?? "Direct"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {known.length > 0 ? (
                        <span title={known.join(", ")}>{known.slice(0, 2).join(", ")}{known.length > 2 ? ` +${known.length - 2}` : ""}</span>
                      ) : (
                        <span className="rounded-full bg-amber-500/15 text-amber-300 px-2 py-0.5 text-[10px] font-semibold">Unknown</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Every page open on the site is recorded, signed in or not (the same IP opening the same page within 5 minutes counts once). "Employee on this IP" means
        an employee has signed in from that IP in the last 90 days — it doesn't prove who opened the page. Visitors on a VPN or mobile network show the provider's location.
      </p>
    </>
  );
}
