/**
 * One commit often holds several changes. For the AHS Updates list each
 * change is shown as its own entry (same commit, same date, "1 of 3"), split
 * only where the message itself lists them:
 *
 *   1. Bullet lines in the body ("- New Action column …", "- Status is a
 *      dropdown …"), two or more → one entry each, under the commit's topic.
 *   2. Otherwise the first line's "; " parts ("Claims: GE job code …; Need
 *      Claim List red REDO …").
 *   3. And a part that is a list of things added ("Add Technician Details
 *      panel, Master List funnel filters, and fix chat spacing") → one per item,
 *      when every item is at least three words (so "Add Damage, Contractor
 *      Data, …" stays whole).
 *
 * Anything that doesn't match stays one entry. Splits happen outside
 * brackets only.
 */

const VERB = /^(add|fix|make|show|replace|move|expand|rebuild|redesign|require|lock|share|improve|enforce|allow|let|link|deep-link|sync|merge|widen|hide|remove|split|surface|log|reduce|filter|number|extract|fold|rework|clean|polish|regenerate|scope|dedupe|pause|block|keep|use|drop|rename|support|wire|switch|send|track|limit|auto-?\w+)\b/i;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Split on a separator, but not inside () [] {} or quotes. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = false, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quote = !quote;
    else if (!quote && "([{".includes(c)) depth++;
    else if (!quote && ")]}".includes(c)) depth = Math.max(0, depth - 1);
    else if (!quote && depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** "Add A, B, and fix C" → ["Add A", "Add B", "Fix C"]; null when it isn't such a list. */
function splitAddList(part: string): string[] | null {
  const verb = VERB.exec(part)?.[0];
  if (!verb) return null;
  const items = splitTop(part, ", ").map((x) => x.replace(/^and\s+/i, ""));
  if (items.length < 2) return null;
  if (items.some((x) => x.split(/\s+/).length < 3)) return null;
  return items.map((x, i) => (i === 0 || VERB.test(x) ? capitalize(x) : `${capitalize(verb.toLowerCase())} ${x}`));
}

function topicOf(first: string): { topic: string; rest: string } | null {
  const colon = first.indexOf(": ");
  if (colon > 2 && colon <= 50 && !first.slice(0, colon).includes(". ")) {
    return { topic: first.slice(0, colon), rest: first.slice(colon + 2) };
  }
  return null;
}

export function splitUpdate(text: string): string[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const first = (lines[0] ?? "").trim();
  const t = topicOf(first);
  const withTopic = (s: string) => (t ? `${t.topic}: ${s}` : capitalize(s));

  // 1. Bullets in the body.
  const items: string[] = [];
  let cur: string | null = null;
  for (const raw of lines.slice(1)) {
    if (/^[-*•]\s+/.test(raw)) {
      if (cur != null) items.push(cur);
      cur = raw.replace(/^[-*•]\s+/, "").trim();
    } else if (cur != null && /^\s+\S/.test(raw)) {
      cur += " " + raw.trim();
    } else if (cur != null) {
      items.push(cur);
      cur = null;
    }
  }
  if (cur != null) items.push(cur);
  const real = items.filter((x) => x.length >= 15);
  if (real.length >= 2) return real.map(withTopic);

  // 2. "; " parts of the first line, 3. each part's "Add A, B, and C" list.
  const body = t ? t.rest : first;
  const semis = splitTop(body, "; ").filter((x) => x.length >= 12);
  const parts = (semis.length >= 2 ? semis : [body]).flatMap((p) => splitAddList(p) ?? [p]);
  if (parts.length < 2) return [text];
  const out = parts.map(withTopic);
  // Any further lines of the message stay with the first entry.
  const more = lines.slice(1).join("\n").trim();
  if (more) out[0] += "\n\n" + more;
  return out;
}
