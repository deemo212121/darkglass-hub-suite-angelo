/**
 * Part Daily Collection / Part Daily Pickup → Daily Summary. The same per-branch
 * write-up the PH Parts team posts every day ("CB - 17 parts not collected
 * from Fredrick Jackson (tech hasn't arrived in the office)"), built from the
 * data instead of by hand:
 *   - per branch: parts not collected, grouped by technician, with each
 *     technician's attendance on the chosen day — Time off (approved
 *     leave), Rest day, Not clocked in, or Clocked in at …
 *   - "Parts out" when nobody on the branch's parts staff (Parts / Parts
 *     Team Leader / Parts Manager) is in that day
 *   - branches whose parts were all collected: "no mistake"
 * A Copy button gives the plain-text version for the group chat.
 */
import { useEffect, useMemo, useState } from "react";
import { Send, Check, Loader2, ListChecks } from "lucide-react";
import { getPartsDailyIssues, upsertPartsDailyIssue } from "@/lib/supabase/partsDailyIssuesLog";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getCompanyTimecardEntries, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getCompanyPtoRequests, type PtoRequestRow, type PtoType } from "@/lib/supabase/pto";
import { branchAbbrev } from "@/lib/branchDisplay";

/** One part on the page — where it is, which tech it belongs to, and whether it's done (collected / picked up). */
export interface SummaryItem {
  location: string;
  techName: string;
  done: boolean;
}

const PTO_LABEL: Record<PtoType, string> = { vacation: "PTO", sick: "Sick", personal: "Personal", holiday: "Holiday", unpaid: "Unpaid", bereavement: "Bereavement" };
const PARTS_ROLES = new Set(["PARTS", "PARTS_TEAM_LEADER", "PARTS_MANAGER"]);
const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s*,\s*/g, ", ").toLowerCase();

type Presence = { kind: "off" | "pending" | "rest" | "absent" | "in"; text: string };

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtTime = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
};

const PRESENCE_CLASS: Record<Presence["kind"], string> = {
  off: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  rest: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  absent: "bg-red-500/15 text-red-300 border-red-500/30",
  in: "bg-green-500/15 text-green-300 border-green-500/30",
};

type BranchLine = {
  branch: string;
  code: string;
  total: number;
  notCollected: number;
  techs: { name: string; count: number; presence: Presence | null }[];
  partsPresence: { name: string; presence: Presence }[];
  partsOut: boolean;
};

/** Example data for "Show sample" — browser only, never saved. */
const SAMPLE_BRANCHES: BranchLine[] = [
  {
    branch: "Columbus", code: "CB", total: 20, notCollected: 17, partsOut: false,
    techs: [{ name: "Fredrick Jackson", count: 17, presence: { kind: "absent", text: "Not clocked in yet" } }],
    partsPresence: [{ name: "Amanda Simmons", presence: { kind: "in", text: "Clocked in 8:02 AM" } }],
  },
  {
    branch: "Cape Girardeau", code: "CG", total: 10, notCollected: 8, partsOut: true,
    techs: [
      { name: "Deprece Harris", count: 6, presence: { kind: "in", text: "Clocked in 7:55 AM" } },
      { name: "Triston Mitchell", count: 2, presence: { kind: "in", text: "Clocked in 8:10 AM" } },
    ],
    partsPresence: [{ name: "Alaska Olinger", presence: { kind: "off", text: "Time off — PTO" } }],
  },
  {
    branch: "Savannah", code: "SV", total: 9, notCollected: 5, partsOut: false,
    techs: [{ name: "Juan Dela Cruz", count: 5, presence: { kind: "off", text: "Time off — Sick" } }],
    partsPresence: [{ name: "Christipher Kennelley", presence: { kind: "in", text: "Clocked in 8:30 AM" } }],
  },
  {
    branch: "Jacksonville", code: "JS", total: 8, notCollected: 6, partsOut: false,
    techs: [{ name: "Tywon Ross", count: 6, presence: { kind: "pending", text: "Unpaid requested (pending)" } }],
    partsPresence: [{ name: "Farahnaz Qasemi", presence: { kind: "in", text: "Clocked in 8:00 AM" } }],
  },
  {
    branch: "Wilmington", code: "WM", total: 7, notCollected: 7, partsOut: false,
    techs: [{ name: "Josh Malloch", count: 7, presence: { kind: "rest", text: "Rest day" } }],
    partsPresence: [{ name: "David Lopez", presence: { kind: "in", text: "Clocked in 7:48 AM" } }],
  },
  ...["Atlanta", "Asheville", "Birmingham", "Chattanooga", "Destin", "Huntsville"].map((branch) => ({
    branch, code: branchAbbrev(branch), total: 4, notCollected: 0, partsOut: false, techs: [], partsPresence: [],
  })),
];

export function CollectionStatusSummary({
  items: rows,
  verb = "collected",
  heading = "Parts Daily Collection",
  remarkSource = "Collection",
}: {
  items: SummaryItem[];
  /** "collected" (Part Daily Collection) or "picked up" (Part Daily Pickup). */
  verb?: string;
  /** Prefix for this page's line in the PO Daily Report remark — "Collection" or "Pickup". */
  remarkSource?: string;
  /** First line of the copied text. */
  heading?: string;
}) {
  const [sample, setSample] = useState(false);
  const [day, setDay] = useState(todayISO);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [ptos, setPtos] = useState<PtoRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getCompanyUsers(), getCompanyTimecardEntries(day, day), getCompanyPtoRequests()])
      .then(([p, e, r]) => {
        if (cancelled) return;
        setProfiles(p);
        setEntries(e);
        setPtos(r);
      })
      .catch((err) => console.error("CollectionStatusSummary: load failed", err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [day]);

  const byName = useMemo(() => {
    const m = new Map<string, ProfileRow>();
    for (const p of profiles) if (p.display_name) m.set(p.display_name.trim().toLowerCase(), p);
    return m;
  }, [profiles]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.profileId, e])), [entries]);

  /** Attendance for one person on `day`. */
  const presenceOf = (p: ProfileRow | undefined): Presence | null => {
    if (!p) return null;
    const leave = ptos.find((r) => r.profileId === p.id && r.startDate <= day && r.endDate >= day && (r.status === "approved" || r.status === "pending"));
    if (leave?.status === "approved") return { kind: "off", text: `Time off — ${PTO_LABEL[leave.ptoType]}` };
    const e = entryById.get(p.id);
    if (e?.checkIn) return { kind: "in", text: `Clocked in ${fmtTime(e.checkIn)}${e.checkOut ? ` – ${fmtTime(e.checkOut)}` : ""}` };
    if (leave?.status === "pending") return { kind: "pending", text: `${PTO_LABEL[leave.ptoType]} requested (pending)` };
    const rest = p.off_days && p.off_days.length > 0 ? p.off_days : [0, 6];
    if (rest.includes(new Date(day + "T00:00:00").getDay())) return { kind: "rest", text: "Rest day" };
    return { kind: "absent", text: day === todayISO() ? "Not clocked in yet" : "No clock-in" };
  };

  const realBranches = useMemo((): BranchLine[] => {
    const byBranch = new Map<string, SummaryItem[]>();
    for (const r of rows) {
      const key = r.location || "(No location)";
      byBranch.set(key, [...(byBranch.get(key) ?? []), r]);
    }
    return [...byBranch.entries()]
      .map(([branch, items]) => {
        const notCollected = items.filter((r) => !r.done);
        const techCounts = new Map<string, number>();
        for (const r of notCollected) {
          const t = (r.techName || "Unassigned").trim();
          techCounts.set(t, (techCounts.get(t) ?? 0) + 1);
        }
        const techs = [...techCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ name, count, presence: presenceOf(byName.get(name.toLowerCase())) }));
        const partsStaff = profiles.filter(
          (p) => p.is_active && norm(p.assigned_branch) === norm(branch) && [p.role, ...(p.extra_roles ?? [])].some((x) => PARTS_ROLES.has(String(x).toUpperCase()))
        );
        const partsPresence = partsStaff.map((p) => ({ name: p.display_name || p.email, presence: presenceOf(p)! }));
        const partsOut = partsStaff.length > 0 && partsPresence.every((x) => x.presence.kind !== "in");
        return { branch, code: branchAbbrev(branch), total: items.length, notCollected: notCollected.length, techs, partsPresence, partsOut };
      })
      .sort((a, b) => b.notCollected - a.notCollected || a.code.localeCompare(b.code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, profiles, entries, ptos, day]);

  const branches = sample ? SAMPLE_BRANCHES : realBranches;
  const withMissing = branches.filter((b) => b.notCollected > 0);
  const clean = branches.filter((b) => b.notCollected === 0);

  const plainText = useMemo(() => {
    const lines: string[] = [`${heading} ${new Date(day + "T00:00:00").toLocaleDateString()}`, ""];
    for (const b of withMissing) {
      const who = b.techs
        .map((t) => `${t.count} from ${t.name}${t.presence ? ` (${t.presence.text.toLowerCase()})` : ""}`)
        .join(", ");
      lines.push(`${b.code} - ${b.notCollected} part${b.notCollected === 1 ? "" : "s"} not ${verb} — ${who}${b.partsOut ? " (PM is out)" : ""}`);
    }
    if (clean.length) {
      lines.push("");
      for (const b of clean) lines.push(`${b.code} - no mistake${b.partsOut ? " (PM is out)" : ""}`);
    }
    return lines.join("\n");
  }, [withMissing, clean, day, heading, verb]);

  /**
   * Send to Remarks — writes each branch's line into that branch's remark on
   * the PO Daily Report (parts_daily_issues_log, same branch + date) as
   * "<Source>: …". Re-sending replaces this page's own line instead of
   * duplicating it; anything else already in the remark is kept.
   */
  const sendToRemarks = async () => {
    const targets = branches.filter((b) => b.branch !== "(No location)");
    if (targets.length === 0) return;
    const dateLabel = new Date(day + "T00:00:00").toLocaleDateString();
    // Sample mode sends too (for trying it out) — stamped "(sample)" so those lines are easy to spot and remove.
    const tag = sample ? `${remarkSource} (sample):` : `${remarkSource}:`;
    if (!window.confirm(`Send ${sample ? "SAMPLE " : ""}${targets.length} branch ${targets.length === 1 ? "remark" : "remarks"} to the PO Daily Report for ${dateLabel}? Each branch's "${tag}" line will be replaced.`)) return;
    setSending(true);
    setSentMsg(null);
    try {
      const existing = await getPartsDailyIssues(day, day);
      for (const b of targets) {
        const who = b.techs.map((t) => `${t.count} from ${t.name}${t.presence ? ` (${t.presence.text.toLowerCase()})` : ""}`).join(", ");
        const body = b.notCollected > 0 ? `${b.notCollected} part${b.notCollected === 1 ? "" : "s"} not ${verb} — ${who}` : "no mistake";
        const line = `${tag} ${body}${b.partsOut ? " (PM is out)" : ""}`;
        const prev = existing.find((e) => e.branch === b.branch && e.date === day)?.remarks ?? "";
        const kept = prev.split("\n").filter((l) => l.trim() && !l.trim().startsWith(tag));
        await upsertPartsDailyIssue(b.branch, day, { remarks: [...kept, line].join("\n") });
      }
      setSentMsg(`Sent to ${targets.length} branch remark${targets.length === 1 ? "" : "s"} for ${dateLabel}.`);
      setTimeout(() => setSentMsg(null), 4000);
    } catch (err) {
      setSentMsg(`Couldn't send: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setSending(false);
    }
  };

  const badge = (p: Presence | null) =>
    p ? <span className={`inline-block px-1.5 py-px rounded text-[10px] font-semibold border ${PRESENCE_CLASS[p.kind]}`}>{p.text}</span> : <span className="text-[10px] text-slate-500">(not on file)</span>;

  return (
    <div className="flex-1 min-w-0 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <ListChecks className="h-4 w-4 text-blue-400" />
        <div className="text-sm font-semibold text-white">{verb === "picked up" ? "Daily Pickup Summary" : "Daily Collection Summary"}</div>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
          Attendance on
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="glass-input text-xs py-0.5 px-1.5 rounded [color-scheme:dark]" style={{ width: "9rem" }} />
        </label>
        <button
          type="button"
          onClick={() => setSample((v) => !v)}
          className={`btn text-xs px-2 py-1 ${sample ? "bg-amber-500/20 text-amber-200" : ""}`}
          title="Example data so you can see the layout — nothing is saved"
        >
          {sample ? "Hide sample" : "Show sample"}
        </button>
        <button
          type="button"
          onClick={sendToRemarks}
          disabled={sending || (loading && !sample)}
          className="btn text-xs px-2 py-1 inline-flex items-center gap-1 bg-blue-600/80 hover:bg-blue-600 text-white disabled:opacity-40"
          title={sample ? `Send the SAMPLE lines to the PO Daily Report remarks (stamped "${remarkSource} (sample):") — for trying it out` : `Write each branch's line into its remark on the PO Daily Report (as "${remarkSource}: …")`}
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {sample ? "Send sample to Remarks" : "Send to Remarks"}
        </button>
      </div>
      {sentMsg && (
        <div className={`mb-2 rounded px-2 py-1 text-[11px] flex items-center gap-1 ${sentMsg.startsWith("Couldn") ? "bg-red-500/10 text-red-300 border border-red-500/30" : "bg-green-500/10 text-green-300 border border-green-500/30"}`}>
          {!sentMsg.startsWith("Couldn") && <Check className="h-3 w-3" />} {sentMsg}
        </div>
      )}
      {sample && (
        <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">Sample data — for preview only, not real parts or attendance.</div>
      )}
      {loading && !sample ? (
        <div className="py-6 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
      ) : branches.length === 0 ? (
        <div className="py-4 text-xs text-slate-500">No parts in this date range.</div>
      ) : (
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1 text-xs">
          {withMissing.map((b) => (
            <div key={b.branch} className="rounded border border-white/5 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-white w-8" title={b.branch}>{b.code}</span>
                <span className="text-amber-300 font-semibold">{b.notCollected} not {verb}</span>
                <span className="text-slate-500">of {b.total}</span>
                {b.partsOut && <span className="px-1.5 py-px rounded text-[10px] font-semibold border bg-red-500/15 text-red-300 border-red-500/30">PM is out</span>}
              </div>
              <div className="mt-1 pl-9 space-y-0.5">
                {b.techs.map((t) => (
                  <div key={t.name} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-slate-200">{t.count} from {t.name}</span>
                    {badge(t.presence)}
                  </div>
                ))}
                {b.partsPresence.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-slate-400">
                    Parts:
                    {b.partsPresence.map((p) => (
                      <span key={p.name} className="inline-flex items-center gap-1">{p.name} {badge(p.presence)}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {clean.length > 0 && (
            <div className="pt-1 text-slate-400">
              <span className="text-green-300 font-semibold">No mistake:</span>{" "}
              {clean.map((b) => `${b.code}${b.partsOut ? " (PM out)" : ""}`).join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
