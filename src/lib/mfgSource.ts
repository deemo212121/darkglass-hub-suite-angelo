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
 * Ticket-number prefix → Work Order Source override.
 *
 * ServicePower sometimes files a manufacturer's own tickets under a
 * warranty administrator's MfgId (e.g. an Electrolux direct-service
 * ticket gets tagged with Assurant's `I990` because Assurant is the
 * warranty admin for that program). The ticket numbers themselves,
 * though, use the manufacturer's numbering scheme — so the ticket
 * number prefix is the most reliable signal that a call is really
 * an Electrolux / Frigidaire / etc. work order.
 *
 * Longest matching prefix wins so a more-specific entry can override
 * a broader one (`"10074"` beats `"100"` for the same ticket).
 */
const TICKET_NO_PREFIX_SOURCE: Record<string, string> = {
  // Electrolux direct-service call numbers routinely start with 1007.
  "1007": "ELECTROLUX",
};

/**
 * Resolve the Work Order Source from a ticket number prefix, if any.
 * Returns "" when no prefix matches.
 */
export function mapSourceFromTicketNumber(
  ticketNo: string | null | undefined,
): string {
  const raw = String(ticketNo ?? "").trim();
  if (!raw) return "";
  // Strip anything that isn't digits or the SP call-suffix ("-10", "-I565", …)
  // so we compare against the pure numeric head.
  const digits = raw.replace(/[^0-9].*$/, "");
  if (!digits) return "";
  // Longest-prefix match wins.
  const prefixes = Object.keys(TICKET_NO_PREFIX_SOURCE).sort(
    (a, b) => b.length - a.length,
  );
  for (const p of prefixes) {
    if (digits.startsWith(p)) return TICKET_NO_PREFIX_SOURCE[p];
  }
  return "";
}

/**
 * Resolve a ServicePower work-order Source.
 *
 * Precedence:
 *   1. A ticket-number prefix override (bypasses SP mis-classification).
 *   2. `mfgName` if it's a readable string.
 *   3. `mfgName` if it's echoing a code, resolved via MFG_ID_SOURCE.
 *   4. `mfgId` via MFG_ID_SOURCE.
 *   5. The raw code as a last-resort fallback.
 */
export function mapSource(
  mfgId: string | null | undefined,
  mfgName?: string | null,
  ticketNo?: string | null,
): string {
  // 1. Ticket-number override wins — SP sometimes files a manufacturer's
  //    direct-service ticket under a warranty admin's MfgId.
  const byTicket = mapSourceFromTicketNumber(ticketNo);
  if (byTicket) return byTicket;

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
