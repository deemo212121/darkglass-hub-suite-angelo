/**
 * Matching the payee name read off an uploaded paystub page ("Adejaun R
 * Tyson", "Jacob T Reed", "Josh Malloch") to an AHS account, for Accounting
 * → Paystubs' review table. Builds on techNameMatch.ts's spelling rules and
 * adds what check stubs do that sheets don't: middle initials ("Jacob T
 * Reed" = Jacob Theodore Reed, but not Jacob Samuel Reed) and the short
 * form of a first name (Jeff = Jeffrey, Matt = Matthew).
 *
 * Nothing is published from a match alone — Accounting confirms each row —
 * so "check" and "ambiguous" are there to say which rows need a look.
 */
import { aliasTechName, nameMatchKey, nameTokens, namesOverlap } from "@/lib/techNameMatch";

export type EmployeeMatchStatus = "matched" | "check" | "ambiguous" | "none";

export interface EmployeeMatchPerson {
  id: string;
  name: string;
  isActive: boolean;
}

export interface EmployeeMatchResult {
  status: EmployeeMatchStatus;
  /** The best match (first of the tied ones when ambiguous), or null. */
  profileId: string | null;
  /** Why it matched — shown on yellow rows ("middle initial", "short first name"). */
  reason: string | null;
  /** Every person tied for the best score, for the "two possible people" note. */
  candidates: EmployeeMatchPerson[];
}

/** 90+ is a green match; 60–89 needs a look. */
const MATCHED = 90;
const MIN = 60;

/** Exactly one letter added, dropped or changed (Frederick / Fredrick). */
function oneLetterApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function score(stub: string, person: string): { score: number; reason: string | null } {
  const aliased = aliasTechName(stub);
  if (nameMatchKey(aliased) === nameMatchKey(person)) return { score: aliased === stub ? 100 : 95, reason: aliased === stub ? null : "known nickname" };

  const s = nameTokens(aliased);
  const p = nameTokens(person);
  if (s.length < 2 || p.length < 2) return { score: 0, reason: null };
  const sFirst = s[0], sLast = s[s.length - 1];
  const pFirst = p[0], pLast = p[p.length - 1];
  const sMiddle = s.slice(1, -1), pMiddle = p.slice(1, -1);
  const sFull = sMiddle.filter((t) => t.length > 1), pFull = pMiddle.filter((t) => t.length > 1);
  const sInitials = sMiddle.filter((t) => t.length === 1);

  const firstSame = sFirst === pFirst;
  const firstShort = !firstSame && Math.min(sFirst.length, pFirst.length) >= 3 && (sFirst.startsWith(pFirst) || pFirst.startsWith(sFirst));
  const firstSpelled = !firstSame && !firstShort && Math.min(sFirst.length, pFirst.length) >= 5 && oneLetterApart(sFirst, pFirst);
  // The account's whole name inside a longer one on the stub ("Manuel H
  // Lopez Tochez" = Manuel Lopez, "Malik R Kaazim-Johnson" = Malik Johnson).
  const overlap = firstSame && namesOverlap(aliased, person);
  // Last name on the stub may be the account's last name or one of its
  // other name parts ("Erick Guzman" = Erick Guzman Juarez).
  const lastSame = sLast === pLast || (p.includes(sLast) && s.length < p.length);
  if (!(firstSame || firstShort || firstSpelled) || !lastSame) return overlap ? { score: 80, reason: "part of the name" } : { score: 0, reason: null };
  if (firstSpelled) return { score: 70, reason: "first name spelled differently" };

  // A middle initial on the stub has to fit one of the account's middle
  // names when the account has any ("Jacob T Reed" ≠ Jacob Samuel Reed).
  const initialsFit = sInitials.every((i) => pFull.length === 0 || pFull.some((m) => m[0] === i));
  if (!initialsFit) return { score: 30, reason: "middle initial doesn't fit" };
  // Full middle names on both sides must agree.
  if (sFull.some((m) => !p.includes(m))) return overlap ? { score: 80, reason: "part of the name" } : { score: 40, reason: "different middle name" };

  if (firstShort) return { score: 70, reason: "short first name" };
  if (sInitials.length > 0 && pFull.length > 0) return { score: 92, reason: "middle initial" };
  if (s.length === p.length || sInitials.length > 0 || sMiddle.length === 0) return { score: 90, reason: sInitials.length > 0 ? "middle initial" : null };
  return { score: 80, reason: "part of the name" };
}

/**
 * The best account for a name read off a paystub. Ties at the top score are
 * "ambiguous" — unless exactly one of them is an active account, which then
 * wins (a deactivated namesake shouldn't hold up a current employee's stub).
 */
export function matchEmployeeName(stubName: string, people: EmployeeMatchPerson[]): EmployeeMatchResult {
  const none: EmployeeMatchResult = { status: "none", profileId: null, reason: null, candidates: [] };
  if (!stubName.trim()) return none;
  let best = 0;
  let top: { person: EmployeeMatchPerson; reason: string | null }[] = [];
  for (const person of people) {
    const { score: sc, reason } = score(stubName, person.name);
    if (sc < MIN || sc < best) continue;
    if (sc > best) {
      best = sc;
      top = [];
    }
    top.push({ person, reason });
  }
  if (top.length === 0) return none;
  if (top.length > 1) {
    const active = top.filter((t) => t.person.isActive);
    if (active.length === 1) top = active;
  }
  if (top.length > 1) {
    return { status: "ambiguous", profileId: top[0].person.id, reason: `${top.length} possible people`, candidates: top.map((t) => t.person) };
  }
  const [{ person, reason }] = top;
  return {
    status: best >= MATCHED && person.isActive ? "matched" : "check",
    profileId: person.id,
    reason: person.isActive ? reason : [reason, "deactivated account"].filter(Boolean).join(" · "),
    candidates: [person],
  };
}
