/**
 * A colour per claim company / manufacturer for the Need Claim List's
 * "Claim To" column and its colour key. Red and amber are left out on
 * purpose — red is REDO and the 30+ days dot, orange/amber is "14+ days /
 * back ordered" and Claims Readiness. Anything not listed is grey.
 */
export interface ClaimToColor {
  label: string;
  /** Tailwind classes for the pill. */
  pill: string;
  /** Tailwind class for the small swatch in the colour key. */
  dot: string;
  /** The same colour as a hex value, for charts. */
  hex: string;
}

const COLORS: { match: RegExp; color: ClaimToColor }[] = [
  { match: /^\s*(ge\b|general electric)/i, color: { label: "GE", pill: "bg-blue-500/15 text-blue-300 border-blue-400/30", dot: "bg-blue-400", hex: "#60a5fa" } },
  { match: /assurant/i, color: { label: "Assurant", pill: "bg-violet-500/15 text-violet-300 border-violet-400/30", dot: "bg-violet-400", hex: "#a78bfa" } },
  { match: /electrolux/i, color: { label: "Electrolux", pill: "bg-teal-500/15 text-teal-300 border-teal-400/30", dot: "bg-teal-400", hex: "#2dd4bf" } },
  { match: /square\s*trade/i, color: { label: "Square Trade", pill: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-400/30", dot: "bg-fuchsia-400", hex: "#e879f9" } },
  { match: /\baig\b/i, color: { label: "AIG", pill: "bg-cyan-500/15 text-cyan-300 border-cyan-400/30", dot: "bg-cyan-400", hex: "#22d3ee" } },
  { match: /centricity/i, color: { label: "Centricity", pill: "bg-lime-500/15 text-lime-300 border-lime-400/30", dot: "bg-lime-400", hex: "#a3e635" } },
  { match: /^\s*nsa\b/i, color: { label: "NSA", pill: "bg-indigo-500/15 text-indigo-300 border-indigo-400/30", dot: "bg-indigo-400", hex: "#818cf8" } },
  { match: /hisense/i, color: { label: "Hisense", pill: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30", dot: "bg-emerald-400", hex: "#34d399" } },
  { match: /speed\s*queen|alliance/i, color: { label: "Speed Queen", pill: "bg-sky-500/15 text-sky-300 border-sky-400/30", dot: "bg-sky-400", hex: "#38bdf8" } },
  { match: /samsung/i, color: { label: "Samsung", pill: "bg-pink-500/15 text-pink-300 border-pink-400/30", dot: "bg-pink-400", hex: "#f472b6" } },
  { match: /dacor/i, color: { label: "Dacor", pill: "bg-stone-500/20 text-stone-300 border-stone-400/30", dot: "bg-stone-400", hex: "#a8a29e" } },
];

export const OTHER_CLAIM_TO: ClaimToColor = { label: "Other", pill: "bg-slate-500/15 text-slate-300 border-slate-400/25", dot: "bg-slate-400", hex: "#94a3b8" };

/** The colour for a Claim To value (account / claim company); grey when it isn't a known company. */
export function claimToColor(value?: string | null): ClaimToColor {
  const v = String(value ?? "");
  return COLORS.find((c) => c.match.test(v))?.color ?? OTHER_CLAIM_TO;
}
