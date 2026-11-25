/**
 * Reads Finance's Branch Commission sheet for Accounting → Branch Commission
 * → Import (BranchCommissionImportModal). One line per BM per branch per
 * week, as they keep it:
 *
 *   Technician (the BM) | Home Location | Role | Week Start | Week End | Week |
 *   Commission Branch | LTP % | Completion % ("Name - 66.7%" per tech) |
 *   Commission $ | Original Calculation ("24*10 = 240") | Flash tech |
 *   Damages | total damage count on area | review status | Status (✔ = paid)
 *
 * Headers are found by name on any tab, so column order doesn't matter.
 * Planning is a plain function: the modal shows every line as ready /
 * warning (imports, worth a look) / error (won't import) / skipped (no
 * numbers on it) and only saves when the user confirms.
 */
import * as XLSX from "xlsx";
import { branchMatchKey } from "./branchName";
import { TRUCK_STOCK_BRANCH_CODE_MAP } from "./truckStockBranchMap";
import { resolveCommissionTier } from "./supabase/branchManagerCommission";

export type ImportLineState = "ready" | "warning" | "error" | "skipped";

export interface ImportTechValue {
  name: string;
  profileId: string;
  profileName: string;
  completionPct: number;
}

export interface ImportLine {
  sheet: string;
  row: number; // 1-based, as in Excel
  state: ImportLineState;
  messages: string[];
  bmName: string;
  branchKey: string;
  branchLabel: string;
  week: string;
  periodStart: string;
  periodEnd: string;
  ltpPct: number | null;
  techs: ImportTechValue[];
  tickets: number | null;
  sheetAmount: number | null;
  appAmount: number | null;
  flashTech: boolean | null;
  damages: boolean | null;
  damageCount: number | null;
  paid: boolean;
  note: string;
}

export interface ImportContext {
  /** Branch key → display name (every branch the tab knows). */
  branches: Map<string, string>;
  /** Technicians the tab lists, with the branch their numbers count under. */
  technicians: Array<{ id: string; name: string; branchKey: string }>;
  /** Branch key → the BM name(s) the tab shows for it. */
  managersOf: (branchKey: string) => string[];
  /** "branchKey|start|end" for every branch-period already marked Paid in the app. */
  paidKeys: Set<string>;
}

const HEADERS: Record<string, string[]> = {
  bm: ["technician", "bm", "bmname", "branchmanager"],
  home: ["homelocation"],
  weekStart: ["weekstart"],
  weekEnd: ["weekend"],
  week: ["week"],
  branch: ["commissionbranch", "branch"],
  ltp: ["ltp", "ltppct"],
  completion: ["completion", "completionpct", "completionratio"],
  amount: ["commission", "commissionamount"],
  calc: ["originalcalculation", "calculation"],
  flash: ["flashtech"],
  damages: ["damages"],
  damageCount: ["totaldamagecountonarea", "totaldamagecount", "totaldamage", "damagecount"],
  review: ["reviewstatus"],
  status: ["status", "paid"],
};

const keyOf = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v)).trim();

function findHeaderRow(rows: unknown[][]): { at: number; cols: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const keys = (rows[i] ?? []).map(keyOf);
    const cols: Record<string, number> = {};
    for (const [field, names] of Object.entries(HEADERS)) {
      const idx = keys.findIndex((k) => names.includes(k));
      if (idx >= 0) cols[field] = idx;
    }
    if (cols.weekStart !== undefined && cols.branch !== undefined) return { at: i, cols };
  }
  return null;
}

function toISODate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = text(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

/** "44.1%", "44.1", or Excel's 0.441 for a %-formatted cell. */
function toPct(v: unknown): number | null {
  if (typeof v === "number") return Math.round((v <= 1.5 ? v * 100 : v) * 100) / 100;
  const m = text(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function toMoney(v: unknown): number | null {
  if (typeof v === "number") return v;
  const m = text(v).replace(/[$,\s]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function toYesNo(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const k = keyOf(v);
  if (["yes", "y", "true"].includes(k)) return true;
  if (["no", "n", "false"].includes(k)) return false;
  return null;
}

function toPaid(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = text(v).toLowerCase();
  return ["true", "yes", "paid", "x", "✓", "✔", "☑", "1"].includes(s);
}

/** "Edward Lindsey- 66.7 %\nKeion West- 59.1 %" → [{ name, pct }]. */
export function parseCompletionText(raw: string): Array<{ name: string; pct: number }> {
  const out: Array<{ name: string; pct: number }> = [];
  const re = /([A-Za-z][A-Za-z.'’ ]*?)\s*[-–:]?\s*(\d+(?:\.\d+)?)\s*%?/g;
  for (const m of raw.replace(/["“”]/g, " ").matchAll(re)) {
    const name = m[1].replace(/\s+/g, " ").trim();
    if (name.length < 3) continue;
    out.push({ name, pct: Number(m[2]) });
  }
  return out;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Exact name first (ignoring capitals/spaces), then a near spelling ("Williakms") — preferring the branch's own techs. */
function matchTech(name: string, branchKey: string, techs: ImportContext["technicians"]) {
  const k = keyOf(name);
  const exact = techs.filter((t) => keyOf(t.name) === k);
  if (exact.length > 0) return { tech: exact.find((t) => t.branchKey === branchKey) ?? exact[0], near: false };
  const limit = k.length >= 10 ? 2 : 1;
  const close = techs
    .map((t) => ({ t, d: editDistance(keyOf(t.name), k) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || Number(b.t.branchKey === branchKey) - Number(a.t.branchKey === branchKey));
  if (close.length === 0) return null;
  if (close.length > 1 && close[0].d === close[1].d && close[0].t.branchKey !== branchKey) return null; // two equally close — don't guess
  return { tech: close[0].t, near: true };
}

/** "ATL", "Atlanta", "Memphis / CG", "Jackson, MS" → the branch keys it could mean. */
function branchCandidates(raw: string, home: string, branches: Map<string, string>): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (!t) return;
    const code = TRUCK_STOCK_BRANCH_CODE_MAP[t.toUpperCase()];
    for (const cand of code ? [code, t] : [t]) {
      const k = branchMatchKey(cand);
      if (branches.has(k) && !out.includes(k)) out.push(k);
      // "Jackson" alone, "Memphis TN" → a branch whose key starts with it / that it starts with.
      if (!branches.has(k) && k.length >= 4) {
        const hits = [...branches.keys()].filter((b) => b && (b.startsWith(k) || k.startsWith(b)));
        if (hits.length === 1 && !out.includes(hits[0])) out.push(hits[0]);
      }
    }
  };
  for (const part of raw.split(/[\/&+]/)) add(part);
  if (out.length === 0 && home) add(home); // "Atlanta, GA" → Atlanta
  return out;
}

export function readWorkbook(data: ArrayBuffer): Array<{ name: string; rows: unknown[][] }> {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null }) }));
}

export function planImport(sheets: Array<{ name: string; rows: unknown[][] }>, ctx: ImportContext): ImportLine[] {
  const lines: ImportLine[] = [];
  type Raw = { line: ImportLine; candidates: string[]; completion: Array<{ name: string; pct: number }>; calcTickets: number | null; calcRate: number | null };
  const raws: Raw[] = [];

  for (const sheet of sheets) {
    const header = findHeaderRow(sheet.rows);
    if (!header) continue;
    const { cols } = header;
    const cell = (r: unknown[], f: string) => (cols[f] === undefined ? null : r[cols[f]]);
    for (let i = header.at + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i] ?? [];
      if (r.every((v) => text(v) === "")) continue;
      const line: ImportLine = {
        sheet: sheet.name,
        row: i + 1,
        state: "ready",
        messages: [],
        bmName: text(cell(r, "bm")),
        branchKey: "",
        branchLabel: text(cell(r, "branch")),
        week: text(cell(r, "week")),
        periodStart: toISODate(cell(r, "weekStart")),
        periodEnd: toISODate(cell(r, "weekEnd")),
        ltpPct: toPct(cell(r, "ltp")),
        techs: [],
        tickets: null,
        sheetAmount: toMoney(cell(r, "amount")),
        appAmount: null,
        flashTech: toYesNo(cell(r, "flash")),
        damages: toYesNo(cell(r, "damages")),
        damageCount: (() => { const n = toMoney(cell(r, "damageCount")); return n === null ? null : Math.max(0, Math.round(n)); })(),
        paid: toPaid(cell(r, "status")),
        note: text(cell(r, "review")),
      };
      const calc = text(cell(r, "calc")).match(/(\d+)\s*[*x×]\s*(\d+(?:\.\d+)?)/i);
      const completion = parseCompletionText(text(cell(r, "completion")));
      raws.push({
        line,
        candidates: branchCandidates(text(cell(r, "branch")), text(cell(r, "home")).split(",")[0], ctx.branches),
        completion,
        calcTickets: calc ? Number(calc[1]) : null,
        calcRate: calc ? Number(calc[2]) : null,
      });
      lines.push(line);
    }
  }

  // Pass 1: lines with nothing to import; dates.
  for (const x of raws) {
    const l = x.line;
    if (x.completion.length === 0 && l.ltpPct === null && (l.sheetAmount === null || l.sheetAmount === 0) && x.calcTickets === null) {
      l.state = "skipped";
      l.messages.push("No numbers on this line (" + (l.note || "no amount entered") + ").");
      continue;
    }
    if (!l.periodStart || !l.periodEnd || l.periodStart > l.periodEnd) {
      l.state = "error";
      l.messages.push("Week Start / Week End aren't readable dates.");
    }
  }

  // Pass 2: branch. A "Memphis / CG" line goes to the branch most of its techs are in, else one no other line that week has.
  const taken = new Set<string>();
  const live = raws.filter((x) => x.line.state !== "skipped" && x.line.state !== "error");
  for (const x of live) if (x.candidates.length === 1) taken.add(`${x.candidates[0]}|${x.line.periodStart}`);
  for (const x of live) {
    const l = x.line;
    let key = x.candidates.length === 1 ? x.candidates[0] : "";
    if (x.candidates.length > 1) {
      const votes = new Map<string, number>();
      for (const c of x.completion) {
        const m = matchTech(c.name, "", ctx.technicians);
        if (m && x.candidates.includes(m.tech.branchKey)) votes.set(m.tech.branchKey, (votes.get(m.tech.branchKey) ?? 0) + 1);
      }
      const byVotes = [...votes.entries()].sort((a, b) => b[1] - a[1]);
      key = byVotes[0]?.[0] ?? x.candidates.find((c) => !taken.has(`${c}|${l.periodStart}`)) ?? "";
      if (key) {
        taken.add(`${key}|${l.periodStart}`);
        l.messages.push(`"${l.branchLabel}" read as ${ctx.branches.get(key)}.`);
      }
    }
    if (!key) {
      l.state = "error";
      l.messages.push(`Branch "${l.branchLabel}" doesn't match a branch in the app.`);
      continue;
    }
    l.branchKey = key;
    l.branchLabel = ctx.branches.get(key) ?? l.branchLabel;
  }

  // Pass 3: one line per branch per week.
  const seen = new Map<string, ImportLine>();
  for (const x of live) {
    const l = x.line;
    if (l.state === "error") continue;
    const k = `${l.branchKey}|${l.periodStart}|${l.periodEnd}`;
    const first = seen.get(k);
    if (first) {
      l.state = "error";
      l.messages.push(`${l.branchLabel} ${l.week || l.periodStart} is already on row ${first.row} — only one line per branch per week.`);
      continue;
    }
    seen.set(k, l);
    if (ctx.paidKeys.has(k)) {
      l.state = "error";
      l.messages.push(`${l.branchLabel} is already marked Paid for this week in the app — undo Paid there first to change it.`);
    }
  }

  // Pass 4: techs, tickets, the $ check.
  for (const x of live) {
    const l = x.line;
    if (l.state === "error") continue;
    const warn = (m: string) => { l.messages.push(m); if (l.state === "ready") l.state = "warning"; };

    const used = new Set<string>();
    for (const c of x.completion) {
      if (c.pct > 100) { warn(`${c.name} ${c.pct}% is over 100% — left out.`); continue; }
      const m = matchTech(c.name, l.branchKey, ctx.technicians);
      if (!m) { warn(`"${c.name}" isn't a technician in the app — left out.`); continue; }
      if (used.has(m.tech.id)) continue;
      used.add(m.tech.id);
      if (m.near) warn(`"${c.name}" read as ${m.tech.name}.`);
      if (m.tech.branchKey !== l.branchKey) {
        warn(`${m.tech.name} is under ${ctx.branches.get(m.tech.branchKey) || "another branch"} in the app — their numbers count there unless you move them.`);
      }
      l.techs.push({ name: c.name, profileId: m.tech.id, profileName: m.tech.name, completionPct: c.pct });
    }
    if (l.techs.length === 0) warn("No technician on this line matched — only the branch's details (tickets, flags, Paid) import.");
    if (l.ltpPct === null) warn("No LTP % on this line.");

    const avgCompletion = l.techs.length ? Math.round((l.techs.reduce((s, t) => s + t.completionPct, 0) / l.techs.length) * 10) / 10 : 0;
    const tier = resolveCommissionTier(avgCompletion, l.ltpPct ?? 0);
    if (x.calcTickets !== null) {
      l.tickets = x.calcTickets;
    } else if (l.sheetAmount && tier.ratePerTicket > 0 && Number.isInteger(Math.round(l.sheetAmount / tier.ratePerTicket * 100) / 100)) {
      l.tickets = Math.round(l.sheetAmount / tier.ratePerTicket);
      warn(`Tickets worked out from the $: ${l.tickets}.`);
    } else {
      warn("Couldn't read the ticket count from Original Calculation — tickets left blank.");
    }

    const bms = ctx.managersOf(l.branchKey).map(keyOf);
    if (l.bmName && bms.length > 0 && !bms.includes(keyOf(l.bmName))) {
      warn(`Sheet says BM ${l.bmName}; the app has ${ctx.managersOf(l.branchKey).join(", ")} for ${l.branchLabel}.`);
    } else if (l.bmName && bms.length === 0) {
      warn(`${l.branchLabel} has no BM in the app — it won't count toward anyone's commission until one is picked.`);
    }

    if (l.tickets !== null && l.techs.length > 0) {
      l.appAmount = tier.ratePerTicket * l.tickets;
      if (l.sheetAmount !== null && Math.abs(l.appAmount - l.sheetAmount) > 0.009) {
        warn(`The app works this out as $${l.appAmount.toFixed(2)} (Condition ${tier.tier}); the sheet says $${l.sheetAmount.toFixed(2)}.`);
      }
    }
  }
  return lines;
}
