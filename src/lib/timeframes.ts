/**
 * Visit time frames. Replaces the old AM/PM/ANYTIME slots.
 * A ticket's time_slot now holds one of these frame labels (e.g. "8-12").
 * "ANYTIME" is kept as a catch-all bucket for tickets not yet assigned a frame.
 */
export const TIME_FRAMES = [
  "8-12",
  "9-1",
  "10-2",
  "11-3",
  "12-4",
  "1-5",
  "2-6",
  "3-7",
  "4-8",
] as const;

export type TimeFrame = (typeof TIME_FRAMES)[number] | "ANYTIME";

// Representative start time (24h "HH:MM") for each frame — used for map/sort.
export const FRAME_START_TIME: Record<string, string> = {
  "8-12": "08:00",
  "9-1": "09:00",
  "10-2": "10:00",
  "11-3": "11:00",
  "12-4": "12:00",
  "1-5": "13:00",
  "2-6": "14:00",
  "3-7": "15:00",
  "4-8": "16:00",
  ANYTIME: "17:30",
};

/**
 * Normalise an arbitrary "time period" string into one of TIME_FRAMES.
 *
 * Service providers (ServicePower, SquareTrade, etc.) emit the window in
 * a handful of shapes:
 *   - "08:00 - 12:00 MORNING"
 *   - "8:00-12:00"
 *   - "1:00 PM - 5:00 PM"
 *   - "AM" / "PM" / "AFTERNOON" / "MORNING" / "EVENING"
 *   - "12-17 AFTERNOON" / "12-17"
 *   - already-normalised "8-12" / "1-5"
 *
 * Returns the matching frame label, or null when nothing usable is found
 * (caller should fall back to "ANYTIME"). The function is tolerant of
 * extra whitespace, casing, and trailing labels.
 */
export function normalizeTimePeriod(raw: string | null | undefined): TimeFrame | null {
  if (!raw) return null;
  const v = String(raw).trim().toUpperCase();
  if (!v) return null;

  // Exact match against a known frame.
  if ((TIME_FRAMES as readonly string[]).includes(v)) return v as TimeFrame;
  if (v === "ANYTIME") return "ANYTIME";

  // Legacy AM/PM/EOD style and bare labels.
  const LABEL_MAP: Record<string, TimeFrame> = {
    AM: "8-12",
    MORNING: "8-12",
    EARLY: "8-12",
    PM: "1-5",
    AFTERNOON: "1-5",
    LATE: "4-8",
    EVENING: "4-8",
    EOD: "4-8",
    ALLDAY: "ANYTIME",
    "ALL DAY": "ANYTIME",
    "ANY": "ANYTIME",
  };
  if (LABEL_MAP[v]) return LABEL_MAP[v];

  // Pull the first two hour tokens (with optional AM/PM) from the string.
  // Examples: "08:00 - 12:00 MORNING", "1:00 PM - 5:00 PM", "12-17".
  const tokenRe = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/g;
  const tokens: Array<{ h: number; ampm: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(v)) && tokens.length < 2) {
    const hRaw = parseInt(m[1], 10);
    if (!Number.isFinite(hRaw)) continue;
    tokens.push({ h: hRaw, ampm: m[3] || "" });
  }
  if (tokens.length < 2) return null;

  // Convert each token to a 24h hour, then collapse back to a 12h
  // representation that matches the TIME_FRAMES naming (uses 1-12 form).
  const to24 = (t: { h: number; ampm: string }) => {
    let h = t.h;
    if (h === 24) h = 0;
    if (t.ampm === "PM" && h < 12) h += 12;
    if (t.ampm === "AM" && h === 12) h = 0;
    // Frame labels never use 0; if we got 0 with no AM/PM hint, leave
    // it as-is and let the matcher fail (we'd rather skip than mis-bucket).
    return h;
  };
  const to12 = (h24: number) => {
    if (h24 === 0) return 12;
    if (h24 <= 12) return h24;
    return h24 - 12;
  };

  const start24 = to24(tokens[0]);
  const startLabel = String(to12(start24));

  // Find the frame whose start hour matches the parsed start hour. The
  // end label is implied (frames are 4h windows). Falls back to a
  // narrowest-match search by start hour only.
  const matchByStart = (TIME_FRAMES as readonly string[]).find((f) => f.startsWith(`${startLabel}-`));
  return (matchByStart as TimeFrame | undefined) ?? null;
}
