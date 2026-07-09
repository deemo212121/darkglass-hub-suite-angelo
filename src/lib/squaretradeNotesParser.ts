/**
 * Parse Squaretrade / Allstate running notes to extract structured
 * part-order and tracking data. The warranty company posts notes in a
 * predictable shape on the SP work order:
 *
 *   "Allstate part order details
 *    Part Number: ACZ74170504
 *    Part Description: ICE DISPENSER ASSEMBLY
 *    Quantity: 1
 *    If used during repair requires return: No
 *    Tracking Number: not yet available"
 *
 *   "Allstate part tracking details
 *    Part Number: ACZ74170504
 *    ...
 *    Tracking Number: 382143340587
 *    Shipping Provider: FedEx"
 *
 * We translate "part order details" rows into Need-PO part transactions
 * and "part tracking details" rows into tracking updates that merge into
 * existing rows by part number.
 */

export interface ParsedPartOrder {
  /** Source kind so callers can decide whether to insert or merge. */
  kind: "order" | "tracking";
  /** ServicePower note date in ISO 8601 form (passes through unchanged). */
  noteDate: string;
  partNo: string;
  partDesc: string;
  quantity: string;
  /** "Yes" / "No" — Squaretrade flags returnable defective parts. */
  requiresReturn: string;
  /** Tracking number or "" when none yet. Skips the "not yet available"
   *  placeholder so callers don't write junk into the tracking field. */
  trackingNumber: string;
  /** Carrier name (FedEx / UPS / USPS / etc.) when present. */
  shippingProvider: string;
  /** Raw note body the part was parsed from — useful for the part note
   *  field so dispatchers can see exactly what SP sent. */
  rawBody: string;
}

const ORDER_HEADER_RE = /\bpart\s+order\s+details\b/i;
const TRACKING_HEADER_RE = /\bpart\s+tracking\s+details\b/i;

/** Strip the doubled apostrophe escaping that ServicePower uses in notes. */
function unescapeSpText(value: string): string {
  return String(value || "").replace(/''/g, "'").trim();
}

/** Extract a labelled value out of a free-text note block. */
function readField(body: string, label: string): string {
  // The notes come back as one long line; SP wraps labels with ":" and
  // separates fields with whitespace. We match up to the next known
  // label keyword so values don't bleed into each other.
  const stopWords =
    "Part Number|Part Description|Quantity|If used during repair requires return|Tracking Number|Shipping Provider";
  const re = new RegExp(
    `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.*?)(?=\\s+(?:${stopWords})\\s*:|$)`,
    "i",
  );
  const m = body.match(re);
  return m ? unescapeSpText(m[1]) : "";
}

/**
 * Parse a single note body into a ParsedPartOrder, or null if the body
 * doesn't look like a Squaretrade part-order / part-tracking note.
 */
export function parseSquaretradeNote(note: { date?: string; body: string }): ParsedPartOrder | null {
  const body = String(note?.body || "");
  if (!body) return null;

  const isOrder = ORDER_HEADER_RE.test(body);
  const isTracking = TRACKING_HEADER_RE.test(body);
  if (!isOrder && !isTracking) return null;

  const partNo = readField(body, "Part Number");
  if (!partNo) return null; // can't link a transaction without a part number

  let tracking = readField(body, "Tracking Number");
  // SP frequently sends "not yet available" before the carrier ships;
  // treat anything without at least one digit as no tracking yet.
  if (!/\d/.test(tracking)) tracking = "";

  return {
    kind: isOrder ? "order" : "tracking",
    noteDate: String(note?.date || ""),
    partNo,
    partDesc: readField(body, "Part Description"),
    quantity: readField(body, "Quantity"),
    requiresReturn: readField(body, "If used during repair requires return"),
    trackingNumber: tracking,
    shippingProvider: readField(body, "Shipping Provider"),
    rawBody: body,
  };
}

/**
 * Run every running note through the parser and collapse the results
 * into one record per part number. Order notes set the baseline (qty,
 * description, requires-return). Tracking notes overlay carrier / tracking
 * number when they arrive later — there can be several tracking notes
 * per part as SP rotates between carriers, so the most recent wins.
 *
 * The returned map is keyed by part number so callers can match against
 * existing rows in the part transaction table.
 */
export function aggregateSquaretradeParts(
  notes: Array<{ date?: string; body: string }>,
): Map<string, ParsedPartOrder> {
  const out = new Map<string, ParsedPartOrder>();
  // Process oldest first so newer notes overwrite older state.
  const sorted = [...notes].sort((a, b) =>
    String(a?.date || "").localeCompare(String(b?.date || "")),
  );
  for (const note of sorted) {
    const parsed = parseSquaretradeNote(note);
    if (!parsed) continue;
    const key = parsed.partNo.toUpperCase();
    const existing = out.get(key);
    if (!existing) {
      out.set(key, parsed);
      continue;
    }
    // Merge: keep the original kind/note date but overlay later fields.
    out.set(key, {
      kind: parsed.kind === "tracking" ? existing.kind : parsed.kind,
      noteDate: existing.noteDate || parsed.noteDate,
      partNo: parsed.partNo || existing.partNo,
      partDesc: parsed.partDesc || existing.partDesc,
      quantity: parsed.quantity || existing.quantity,
      requiresReturn: parsed.requiresReturn || existing.requiresReturn,
      trackingNumber: parsed.trackingNumber || existing.trackingNumber,
      shippingProvider: parsed.shippingProvider || existing.shippingProvider,
      rawBody: parsed.rawBody, // keep the newest body for traceability
    });
  }
  return out;
}
