/**
 * What changed between two versions of a set of terms, marked in the newer
 * one's HTML so people can see it before they agree (Sir Naveen, 11/06):
 * added words wrapped in <ins class="terms-added">, removed ones shown
 * struck through in <del class="terms-removed"> where they were. The accept
 * window compares with the version the person last accepted (or, if they
 * never accepted one, the version before); Admin → Pop up Forms → Preview
 * compares the draft with what's live.
 *
 * Word by word, over the HTML split into tags, spaces and words. The new
 * version's tags are kept as they are — a new paragraph's tags come through
 * and only its words are marked — so the markup stays whole. A removed
 * paragraph's words show struck through inside the one next to it.
 */

type Token = { text: string; kind: "tag" | "space" | "word" };

const TOKEN = /(<[^>]*>)|(\s+)|([^<\s]+)/g;

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  for (const m of html.matchAll(TOKEN)) out.push({ text: m[0], kind: m[1] ? "tag" : m[2] ? "space" : "word" });
  return out;
}

/** What two tokens are compared by: spaces are all alike, everything else as written. */
const keyOf = (t: Token) => (t.kind === "space" ? " " : t.text);

/** Beyond this many edits the versions are too different to mark word by word. */
const MAX_EDITS = 1500;

type Op = "=" | "+" | "-";

/** Myers' shortest edit script between a and b — "=" keep, "+" b's next, "-" a's next. null when they differ in more than MAX_EDITS places. */
function editScript(a: string[], b: string[]): Op[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length;
  const m = B.length;
  const max = Math.min(n + m, MAX_EDITS);
  const off = max + 1;
  let v: Int32Array = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = n + m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }
  if (!found) return null;
  const mid: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
    const prevX = v[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { mid.push("="); x--; y--; }
    if (d > 0) mid.push(x === prevX ? "+" : "-");
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { mid.push("="); x--; y--; }
  mid.reverse();
  return [...Array<Op>(pre).fill("="), ...mid, ...Array<Op>(suf).fill("=")];
}

export interface TermsChanges {
  /** The newer version's HTML with the changes marked. */
  html: string;
  /** How many separate places changed. */
  changes: number;
}

/**
 * The newer HTML with what changed since the older one marked, and how many
 * places changed (0 = same text). null when they're too different to mark.
 */
export function markTermsChanges(olderHtml: string, newerHtml: string): TermsChanges | null {
  const a = tokenize(olderHtml);
  const b = tokenize(newerHtml);
  const ops = editScript(a.map(keyOf), b.map(keyOf));
  if (!ops) return null;
  let out = "";
  let changes = 0;
  // The change being built: removed words, added text, and spaces left between them (unchanged ones).
  let del = "";
  let ins = "";
  let gap = "";
  // An edit since the last unchanged word / tag — a tag inside an added paragraph doesn't start a new change.
  let inChange = false;
  const flush = () => {
    const removed = del.trim();
    const added = ins.trim();
    if (removed) out += `<del class="terms-removed">${removed}</del>`;
    if (removed && added) out += " ";
    if (added) out += `${ins.match(/^\s*/)![0]}<ins class="terms-added">${added}</ins>${ins.match(/\s*$/)![0]}`;
    else out += ins;
    if ((removed || added) && !inChange) changes++;
    if (removed || added) inChange = true;
    del = "";
    ins = "";
  };
  const pending = () => del !== "" || ins !== "";
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    if (op === "=") {
      const t = b[bi++];
      ai++;
      // Spaces between two edits keep them one change.
      if (t.kind === "space" && pending()) { gap += t.text; continue; }
      flush();
      out += gap + t.text;
      gap = "";
      if (t.kind !== "space") inChange = false;
    } else if (op === "+") {
      const t = b[bi++];
      if (t.kind === "tag") { flush(); out += gap + t.text; gap = ""; continue; }
      // Spaces between added words stay inside the mark; after removed words, flush puts one space between.
      if (ins) ins += gap;
      gap = "";
      ins += t.text;
    } else {
      const t = a[ai++];
      if (t.kind === "tag") continue;
      if (t.kind === "space" || (gap && del && !del.endsWith(" "))) del += " ";
      if (t.kind === "word") del += t.text;
    }
  }
  flush();
  out += gap;
  return { html: out, changes };
}
