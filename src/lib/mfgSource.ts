/**
 * ServicePower MfgId → readable Work Order Source.
 *
 * Lives in its own tiny module so both servicePowerSync (which calls it
 * during convertCallToTicket) AND supabase/tickets (which uses it to
 * re-resolve stale stored codes on read) can import it without creating
 * a circular dependency.
 *
 * Add new entries here when SP returns a code we haven't mapped yet — the
 * read-side resolveSource picks them up on the next page load with no DB
 * migration required.
 */

const MFG_ID_SOURCE: Record<string, string> = {
  I565: "SQUARE TRADE",
  I455: "ASSURANT SOLUTIONS",
  I990: "ASSURANT SOLUTIONS",
  B100: "CENTRICITY",
  I404: "GE",
  I406: "GE",
  I402: "GE",
  I698: "AIG WARRANTY",
  K100: "SPPN",
  I250: "ALLIANCE - SPEED QUEEN",
  // Add new entries here when SP returns an unmapped code. Until a code is
  // mapped here the ticket displays the raw code (e.g. "I421") in
  // Work Order Source so it's visible and reportable rather than silently
  // misclassified.
};

/**
 * Resolve a ServicePower work-order Source.
 *
 * - If `mfgName` is a readable string, prefer it (uppercased).
 * - If `mfgName` is actually echoing a code (e.g. "K100"), resolve through map.
 * - Otherwise look the `mfgId` code up in the map.
 * - Falls back to the raw code so unmapped values are visible (not silently
 *   dropped) and can be reported back for mapping.
 */
export function mapSource(
  mfgId: string | null | undefined,
  mfgName?: string | null,
): string {
  const nameRaw = String(mfgName ?? "").trim();
  const code = String(mfgId ?? "").trim().toUpperCase();

  if (nameRaw) {
    const upper = nameRaw.toUpperCase();
    const looksLikeCode = /^[A-Z]\d{2,4}$/.test(upper);
    if (looksLikeCode && MFG_ID_SOURCE[upper]) return MFG_ID_SOURCE[upper];
    if (!looksLikeCode) return upper;
  }

  return MFG_ID_SOURCE[code] || code || "";
}
