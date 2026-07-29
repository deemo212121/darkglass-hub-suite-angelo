import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyUsers, updateCompanyUser, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyLoginEvents, type LoginEvent } from "@/lib/supabase/loginEvents";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";
import { haversineMiles } from "@/lib/mapEngine";

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

/** A login more than this far from the user's own usual location gets flagged. Cloudflare's IP geolocation is city-accurate, not exact, so this is set well above normal same-metro jitter. */
const UNUSUAL_DISTANCE_MILES = 50;

interface UserLoginStats {
  profile: ProfileRow;
  lastEvent: LoginEvent | null;
  mostUsedIp: string | null;
  unusualLocation: boolean;
  usualLocationLabel: string | null;
}

function roleDisplay(role: string | null | undefined): string {
  if (!role) return "";
  return ROLE_LABELS[normalizeRole(role)] || role;
}

function locationLabel(e: Pick<LoginEvent, "city" | "region" | "country"> | null): string {
  if (!e) return "—";
  return [e.city, e.region, e.country].filter(Boolean).join(", ") || "—";
}

/** Most frequent value in a list of non-null strings (first-seen wins ties). */
function mode(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function computeUserStats(profile: ProfileRow, events: LoginEvent[]): UserLoginStats {
  // events is already sorted newest-first company-wide; filter to this user.
  const mine = events.filter((e) => e.profileId === profile.id);
  const lastEvent = mine[0] ?? null;
  const mostUsedIp = mode(mine.map((e) => e.ip));

  let unusualLocation = false;
  let usualLocationLabel: string | null = null;
  if (lastEvent && lastEvent.latitude != null && lastEvent.longitude != null) {
    const prior = mine.slice(1).filter((e) => e.latitude != null && e.longitude != null);
    if (prior.length > 0) {
      const usualKey = mode(prior.map((e) => `${e.city ?? ""}|${e.region ?? ""}|${e.country ?? ""}`));
      const usualEvent = prior.find((e) => `${e.city ?? ""}|${e.region ?? ""}|${e.country ?? ""}` === usualKey);
      if (usualEvent && usualEvent.latitude != null && usualEvent.longitude != null) {
        usualLocationLabel = locationLabel(usualEvent);
        const distance = haversineMiles(
          { lat: lastEvent.latitude, lng: lastEvent.longitude },
          { lat: usualEvent.latitude, lng: usualEvent.longitude }
        );
        if (distance > UNUSUAL_DISTANCE_MILES && locationLabel(lastEvent) !== usualLocationLabel) {
          unusualLocation = true;
        }
      }
    }
  }

  return { profile, lastEvent, mostUsedIp, unusualLocation, usualLocationLabel };
}

export function LoginSecurityPage({ mod, sub }: Props) {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [historyFor, setHistoryFor] = useState<UserLoginStats | null>(null);
  const [freezeTarget, setFreezeTarget] = useState<ProfileRow | null>(null);
  const [freezing, setFreezing] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [userRows, loginRows] = await Promise.all([getCompanyUsers(), getCompanyLoginEvents()]);
      setProfiles(userRows);
      setEvents(loginRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Same is_active flag User Management's Deactivate/Reactivate uses — this
  // is that same action, surfaced here too so an admin looking at a flagged
  // login doesn't have to leave the page to lock the account.
  const handleToggleFreeze = async () => {
    if (!freezeTarget) return;
    const reactivating = !freezeTarget.is_active;
    setFreezing(true);
    try {
      await updateCompanyUser(freezeTarget.id, { isActive: reactivating });
      await loadData();
    } catch (err) {
      alert(`Error ${reactivating ? "unfreezing" : "freezing"} account: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFreezing(false);
      setFreezeTarget(null);
    }
  };

  const stats = useMemo(() => profiles.map((p) => computeUserStats(p, events)), [profiles, events]);

  // Two different employees whose most recent login shares the same IP —
  // compared "most recent vs most recent" (not full history) so this
  // reflects who's CURRENTLY sharing a connection, not every IP anyone on
  // the team has ever happened to log in from (e.g. the office Wi-Fi).
  const sharedIpGroups = useMemo(() => {
    const byIp = new Map<string, UserLoginStats[]>();
    for (const s of stats) {
      const ip = s.lastEvent?.ip;
      if (!ip) continue;
      if (!byIp.has(ip)) byIp.set(ip, []);
      byIp.get(ip)!.push(s);
    }
    const shared = new Map<string, string[]>(); // profileId -> other display names sharing that IP
    for (const group of byIp.values()) {
      if (group.length < 2) continue;
      for (const s of group) {
        const others = group.filter((g) => g.profile.id !== s.profile.id).map((g) => g.profile.display_name || g.profile.email);
        shared.set(s.profile.id, others);
      }
    }
    return shared;
  }, [stats]);

  // Role column funnel — same TicketColumnFilter component/behavior as
  // Ticket List's column filters. Options come from the full roster (not
  // narrowed by search), same as the other funnel-filter pages in this app.
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const roleOptions = useMemo(() => Array.from(new Set(stats.map((s) => roleDisplay(s.profile.role)))), [stats]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stats.filter((s) => {
      if (roleFilter.size > 0 && !roleFilter.has(roleDisplay(s.profile.role))) return false;
      if (!q) return true;
      const blob = [s.profile.display_name, s.profile.username, s.profile.email, s.lastEvent?.ip, locationLabel(s.lastEvent)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [stats, search, roleFilter]);

  // Click the User header to cycle A-Z -> Z-A -> back to the original
  // (unsorted, whatever order getCompanyUsers/search produced) list.
  const [userSort, setUserSort] = useState<"none" | "asc" | "desc">("none");
  const cycleUserSort = () => setUserSort((prev) => (prev === "none" ? "asc" : prev === "asc" ? "desc" : "none"));
  const sortedFiltered = useMemo(() => {
    if (userSort === "none") return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const nameA = (a.profile.display_name || a.profile.email).toLowerCase();
      const nameB = (b.profile.display_name || b.profile.email).toLowerCase();
      return userSort === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });
    return copy;
  }, [filtered, userSort]);

  return (
    <main className="w-full px-6 py-6 flex-none">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
          {mod.label}
        </Link>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
          <p className="text-sm text-muted-foreground">{sub.description}</p>
        </div>
        <button
          onClick={() => void loadData()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-2 btn hover:bg-white/15 disabled:opacity-60"
          title="Re-read logins from Supabase"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">
          <span className="text-foreground font-medium">{filtered.length}</span> users
          {loading ? " · loading…" : null}
          {error ? <span className="text-red-300 ml-3">⚠ {error}</span> : null}
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search in result"
          className="glass-input text-xs py-1 px-2 rounded-md w-52"
        />
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                <button
                  type="button"
                  onClick={cycleUserSort}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  title="Click to sort A-Z, click again for Z-A, click again to reset"
                >
                  User
                  {userSort === "asc" ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : userSort === "desc" ? (
                    <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-50" />
                  )}
                </button>
              </th>
              <th className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                <span className="inline-flex items-center">
                  Role
                  <TicketColumnFilter options={roleOptions} selected={roleFilter} onChange={setRoleFilter} label="Filter by Role" />
                </span>
              </th>
              {["Last Login", "Last Login IP", "Most Used IP", "Browser", "Device", "Location", "Flags", "Actions"].map((h) => (
                <th key={h} className="px-2 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedFiltered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                  {loading ? "Loading…" : "No users match the current search."}
                </td>
              </tr>
            ) : (
              sortedFiltered.map((s, idx) => {
                const sharedWith = sharedIpGroups.get(s.profile.id);
                return (
                  <tr
                    key={s.profile.id}
                    className={`border-b border-white/5 hover:bg-white/5 ${idx % 2 !== 0 ? "bg-white/[0.02]" : ""}`}
                  >
                    <td className="px-2 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setHistoryFor(s)}
                        className="font-semibold text-blue-300 hover:text-blue-200 hover:underline"
                        title="View full login history"
                      >
                        {s.profile.display_name || s.profile.email}
                      </button>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{roleDisplay(s.profile.role)}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                      {s.lastEvent ? new Date(s.lastEvent.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono">{s.lastEvent?.ip || "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono text-muted-foreground">{s.mostUsedIp || "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{s.lastEvent?.browser || "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{s.lastEvent?.device || "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{locationLabel(s.lastEvent)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        {s.unusualLocation && (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300"
                            title={`Usually logs in from ${s.usualLocationLabel}`}
                          >
                            ⚠ Unusual location
                          </span>
                        )}
                        {sharedWith && sharedWith.length > 0 && (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-red-300"
                            title={`Same IP as: ${sharedWith.join(", ")}`}
                          >
                            ⚠ Shared IP ({sharedWith.join(", ")})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setFreezeTarget(s.profile)}
                        className={
                          s.profile.is_active === false
                            ? "rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
                            : "rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                        }
                      >
                        {s.profile.is_active === false ? "Unfreeze" : "Freeze"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-muted-foreground">
        * Location is Cloudflare's edge-resolved geolocation for the login's IP — approximate, not exact. "Unusual location" compares a
        user's most recent login against their own prior history, not a fixed home base.
      </div>

      {historyFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm"
          onClick={() => setHistoryFor(null)}
        >
          <div
            className="relative max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-slate-950/95 px-5 py-4 backdrop-blur-md">
              <div>
                <h2 className="text-xl font-bold tracking-tight">{historyFor.profile.display_name || historyFor.profile.email}</h2>
                <p className="mt-1 text-sm text-slate-300">Full login history</p>
              </div>
              <button type="button" onClick={() => setHistoryFor(null)} className="btn hover:bg-slate-800">
                Close
              </button>
            </div>
            <div className="p-5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {["Timestamp", "IP", "Browser", "Device", "Location", "Notes"].map((h) => (
                      <th key={h} className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Newest-first, matching how getCompanyLoginEvents orders them.
                    const userEvents = events.filter((e) => e.profileId === historyFor.profile.id);
                    if (userEvents.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                            No login history recorded yet.
                          </td>
                        </tr>
                      );
                    }
                    return userEvents.map((e, i) => {
                      // "New" = first time this IP/location shows up anywhere
                      // OLDER than this row — i.e. this login is what
                      // introduced it into the user's history. The very
                      // oldest row never counts (nothing came before it to
                      // compare against, so everything about it is trivially
                      // "first").
                      const olderEvents = userEvents.slice(i + 1);
                      const ipIsNew = olderEvents.length > 0 && !!e.ip && !olderEvents.some((o) => o.ip === e.ip);
                      const locIsNew =
                        olderEvents.length > 0 && locationLabel(e) !== "—" && !olderEvents.some((o) => locationLabel(o) === locationLabel(e));
                      const flagged = ipIsNew || locIsNew;
                      return (
                        <tr
                          key={e.id}
                          className={`border-b border-white/5 hover:bg-white/5 ${flagged ? "bg-amber-500/10" : ""}`}
                        >
                          <td className="px-2 py-2 whitespace-nowrap text-slate-300">{new Date(e.createdAt).toLocaleString()}</td>
                          <td className="px-2 py-2 whitespace-nowrap font-mono">{e.ip || "—"}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{e.browser || "—"}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{e.device || "—"}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-slate-300">{locationLabel(e)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <div className="flex gap-1">
                              {ipIsNew && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">New IP</span>}
                              {locIsNew && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">New location</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {freezeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-xl border border-white/15 bg-slate-950/95 p-5 shadow-2xl shadow-black/60">
            <h2 className="text-lg font-bold text-white">
              {freezeTarget.is_active === false ? "Unfreeze account?" : "Freeze account?"}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {freezeTarget.is_active === false
                ? `Unfreeze ${freezeTarget.display_name || freezeTarget.email}? They'll be able to log in again.`
                : `Freeze ${freezeTarget.display_name || freezeTarget.email}? They won't be able to log in until unfrozen. Their records stay intact.`}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setFreezeTarget(null)} className="btn hover:bg-slate-800" disabled={freezing}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleToggleFreeze()}
                disabled={freezing}
                className={freezeTarget.is_active === false ? "btn btn-primary disabled:opacity-50" : "btn btn-danger disabled:opacity-50"}
              >
                {freezing ? "Working…" : freezeTarget.is_active === false ? "Unfreeze" : "Freeze"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
