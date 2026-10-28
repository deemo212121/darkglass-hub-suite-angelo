/**
 * AHS Server Status → AHS Updates (Admin and up): every update Angelo, Jhon and John Oliver
 * made to the app, each read from their own repo. The list is
 * src/lib/teamUpdates.json, built by scripts/team-updates.cjs (loaded only
 * when this page opens — it's large).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, GitCommitHorizontal, Loader2, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isAdminOrAboveHolder } from "@/lib/roleLabels";

export function TeamUpdatesPage() {
  const navigate = useNavigate();
  const { role, extraRoles, realRole } = useAuth();
  if (!isAdminOrAboveHolder(realRole ?? role, extraRoles)) {
    return (
      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-8">
        <p className="mt-1 text-sm text-slate-400">The Updates page is only available to Admin and up.</p>
      </main>
    );
  }
  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/m/$module", params: { module: "server-status" } })}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
          aria-label="Back to AHS Server Status"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-[220px]">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <GitCommitHorizontal className="h-5 w-5 text-blue-400" /> AHS Updates
          </h1>
          <p className="text-sm text-slate-400">Every update made to the app, newest first.</p>
        </div>
      </div>
      <TeamUpdatesPanel />
    </main>
  );
}

interface Update { hash: string; date: string; text: string; files: number }
interface Person { key: string; name: string; updates: Update[] }
interface TeamUpdates { generatedAt: string; people: Person[] }

const RANGES: { key: string; label: string; days: number | null }[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

const PAGE = 50;

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });

/** Cut at the first sentence when it runs long — the full text opens below. */
function shorten(line: string, max = 160): string {
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(": "));
  return (stop > 60 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(" "))) + " …";
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A short title for the update plus the line under it: "Staff Form Checklist:
 * complete Form W-4's …" → title "Staff Form Checklist"; a short message is
 * its own title; a long one without a "Topic:" lead is titled by its first
 * clause.
 */
function titleOf(text: string): { title: string; summary: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = (lines[0] ?? "").replace(/^(feat|fix|chore|refactor|perf|docs|style)(\([^)]*\))?:\s*/i, "");
  const rest = lines.slice(1).join(" ");
  const colon = first.indexOf(": ");
  if (colon > 2 && colon <= 50 && !first.slice(0, colon).includes(". ")) {
    return { title: first.slice(0, colon), summary: shorten(capitalize(first.slice(colon + 2))) };
  }
  if (first.length <= 70) return { title: capitalize(first), summary: shorten(rest) };
  const head = first.slice(0, 70);
  const at = [" - ", " — ", " (", "; ", ", "].map((s) => head.indexOf(s)).filter((i) => i >= 20);
  if (at.length) return { title: capitalize(first.slice(0, Math.min(...at))), summary: shorten(first) };
  // No natural break — cut on a word, never ending on "and" / "the" / "of"…
  const words = head.slice(0, head.lastIndexOf(" ")).split(" ");
  while (words.length > 3 && /^(and|or|the|of|to|with|for|in|on|a|an|from|by|its|their)$/i.test(words[words.length - 1])) words.pop();
  return { title: capitalize(words.join(" ").replace(/[,;:]$/, "")) + " …", summary: shorten(first) };
}

export function TeamUpdatesPanel() {
  const [data, setData] = useState<TeamUpdates | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [range, setRange] = useState("30d");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    import("@/lib/teamUpdates.json")
      .then((m) => setData((m.default ?? m) as TeamUpdates))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => setShown(PAGE), [range, query]);

  const inRange = useMemo(() => {
    if (!data) return [];
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    const since = days == null ? 0 : Date.now() - days * 86400000;
    return data.people.flatMap((p) =>
      p.updates.filter((u) => new Date(u.date).getTime() >= since).map((u) => ({ ...u, personKey: p.key, personName: p.name })),
    );
  }, [data, range]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inRange
      .filter((u) => !q || u.text.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [inRange, query]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  let lastDay = "";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <GitCommitHorizontal className="h-4 w-4 translate-y-0.5 text-slate-400" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">Updates</h2>
        <span className="text-xs text-slate-500">
          What everyone changed in the app{data ? ` · list as of ${dayLabel(data.generatedAt)}, ${timeLabel(data.generatedAt)} CST` : ""}
        </span>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3 space-y-3">
        {loadError ? (
          <p className="text-sm text-red-300">Couldn't load the updates list.</p>
        ) : !data ? (
          <p className="flex items-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Loading updates…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-slate-400 tabular-nums">
                <span className="font-semibold text-white">{list.length.toLocaleString()}</span> update{list.length === 1 ? "" : "s"}
                {" · "}{list.reduce((n, u) => n + u.files, 0).toLocaleString()} files
              </p>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search updates"
                    aria-label="Search updates"
                    className="w-48 rounded-lg border border-white/10 bg-slate-800 py-1 pl-7 pr-2 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <select
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  aria-label="Time range"
                  className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
            </div>

            {list.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-500">No updates {query ? "match that search " : ""}in this time range.</p>
            ) : (
              <ul className="space-y-1.5">
                {list.slice(0, shown).map((u) => {
                  const key = `${u.personKey}-${u.hash}`;
                  const day = dayLabel(u.date);
                  const showDay = day !== lastDay;
                  lastDay = day;
                  const isOpen = open.has(key);
                  const { title, summary } = titleOf(u.text);
                  const hasMore = u.text.trim() !== title && u.text.trim() !== summary;
                  return (
                    <li key={key}>
                      {showDay && <p className="pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{day}</p>}
                      <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <h3 className="text-sm font-semibold text-white">{title}</h3>
                          <p className="text-xs text-slate-400">
                            <span className="tabular-nums">{timeLabel(u.date)} CST</span>
                            {` · ${u.files} file${u.files === 1 ? "" : "s"} · `}
                            <span className="font-mono text-[11px] text-slate-500">{u.hash}</span>
                          </p>
                        </div>
                        {summary && <p className="mt-0.5 text-sm text-slate-300">{summary}</p>}
                        {hasMore && (
                          <button
                            type="button"
                            onClick={() => toggle(key)}
                            aria-expanded={isOpen}
                            className="mt-1 inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"
                          >
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            {isOpen ? "Hide details" : "Show details"}
                          </button>
                        )}
                        {isOpen && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-300">{u.text}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {list.length > shown && (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Show more ({list.length - shown} left)
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
