/**
 * ServicePower Running Notes client.
 *
 * Each ticket detail's "Running Notes" thread mirrors ServicePower's per-call
 * note stream. We never persist these to Supabase — they live on SP and we
 * fetch them on demand. Posting a new note pushes it back to SP via the
 * updateCallInfo SOAP op.
 */

export interface ServicePowerNote {
  /** ISO 8601 date string from <NotesDate>. */
  date: string;
  /** Free-text body from <Notes>. */
  body: string;
  /** <AddedBy> — usually a servicer / user code (e.g. "GSL00002"). */
  addedBy: string;
  /** Optional <Remarks> field if present. */
  remarks?: string;
  /** Whether ServicePower flagged the note as internal vs external. The
   * Dispatch WSDL exposes this in different ways across tenants; we look
   * for a few common tag names. Falls back to true (internal). */
  isInternal: boolean;
}

/** Parse <NoteList>/<Note> blocks out of a getCallNotes SOAP response. */
export function parseGetCallNotesResponse(xml: string): {
  success: boolean;
  notes: ServicePowerNote[];
  error?: string;
} {
  if (!xml || typeof xml !== "string") {
    return { success: false, notes: [], error: "empty XML" };
  }

  // SP error envelopes carry <Result> ER + <ErrMessage>; if found, surface it.
  const errMatch = xml.match(/<(?:[A-Za-z][\w.-]*:)?ErrMessage[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w.-]*:)?ErrMessage>/i);
  if (errMatch) {
    const msg = errMatch[1].trim();
    if (msg) return { success: false, notes: [], error: msg };
  }

  // SP tenants use a wide variety of block tag names for the running-notes
  // thread. Try each and accumulate matches; we de-dupe by date+body+addedBy.
  // RemarksCollection is the canonical wrapper that SP's getCallNotes
  // response uses (each <RemarksCollection> entry = one note).
  const blockTags = [
    "RemarksCollection",
    "CallNote",
    "NoteInfo",
    "RunningNote",
    "CallComment",
    "Comment",
    "Note",
  ];
  const seen = new Set<string>();
  const notes: ServicePowerNote[] = [];

  for (const tag of blockTags) {
    const re = new RegExp(
      `<(?:[A-Za-z][\\w.-]*:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z][\\w.-]*:)?${tag}>`,
      "gi",
    );
    const matches = xml.matchAll(re);
    for (const m of matches) {
      const inner = m[1];
      // Skip blocks that don't carry a body field — `<Note>` is often used as
      // a generic comment label in the docs and could match something useless.
      if (!/<(?:[A-Za-z][\w.-]*:)?(Notes|NoteText|Text|Body|Comment(?!s)|RunningNote|CommentText)[^>]*>/i.test(inner)) {
        continue;
      }
      const note = blockToNote(inner);
      const key = `${note.date}::${note.addedBy}::${note.body}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push(note);
    }
  }

  const filtered = notes.filter((n) => n.body || n.date);
  filtered.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return { success: true, notes: filtered };
}

function blockToNote(xml: string): ServicePowerNote {
  const get = (tag: string) => {
    const re = new RegExp(
      `<(?:[A-Za-z][\\w.-]*:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z][\\w.-]*:)?${tag}>`,
      "i",
    );
    const m = xml.match(re);
    return m ? m[1].trim() : "";
  };
  // Note body — SP variants.
  const body =
    get("Notes") ||
    get("NoteText") ||
    get("RunningNote") ||
    get("CommentText") ||
    get("Comment") ||
    get("Text") ||
    get("Body") ||
    get("Note");
  const rawDate =
    get("NotesDate") ||
    get("NoteDate") ||
    get("CommentDate") ||
    get("DateAdded") ||
    get("CreatedOn") ||
    get("AddedOn") ||
    get("Date");
  // SP returns dates like "06/18/2026 12:59:33"; normalise to ISO so the UI
  // can format them with toLocaleString and they sort chronologically.
  const date = normalizeSpDate(rawDate);
  const addedBy =
    get("AddedBy") ||
    get("Author") ||
    get("UserID") ||
    get("User") ||
    get("CreatedBy");
  const remarks = get("Remarks") || undefined;
  // Visibility flag — try every common SP tag name. If SP explicitly flagged
  // the note we honour that; otherwise fall back to the AddedBy heuristic.
  const visTag =
    get("NoteType") ||
    get("CommentType") ||
    get("Type") ||
    get("Visibility") ||
    get("Vis") ||
    get("Internal") ||
    get("IsInternal") ||
    get("IsInternalNote") ||
    "";
  const isInternal = classifyVisibility(visTag, addedBy);
  return { date, body, addedBy, remarks, isInternal };
}

/** Servicer account that identifies "us" in SP. Used to decide whether a
 * running note posted via SP is one of our own (internal) or one from the
 * warranty company / manufacturer (external) when SP doesn't include an
 * explicit visibility tag. */
const OUR_SERVICER_ACCOUNT =
  (typeof import.meta !== "undefined"
    ? (import.meta as any).env?.VITE_SERVICEPOWER_SERVICER_ACCOUNT
    : undefined) || "GSL00002";

function classifyVisibility(rawTag: string, addedBy: string): boolean {
  const t = rawTag.trim().toLowerCase();
  if (t) {
    // Explicit hints from SP win over the heuristic.
    if (t === "external" || t === "ext" || t === "public" || t === "n" || t === "false" || t === "0") {
      return false;
    }
    if (t === "internal" || t === "int" || t === "private" || t === "y" || t === "true" || t === "1") {
      return true;
    }
  }
  // Heuristic: notes posted by our servicer account are internal-to-us by
  // default; everything else (warranty company, manufacturer, SP automations
  // that target the customer-facing thread) is external.
  const author = String(addedBy ?? "").trim().toUpperCase();
  if (!author) return false;
  if (OUR_SERVICER_ACCOUNT && author === String(OUR_SERVICER_ACCOUNT).toUpperCase()) return true;
  // Treat any email-style AddedBy (e.g. admin@usinhomeservices.com) as our
  // own internal staff member signed in to SP HUB directly.
  if (author.includes("@")) return true;
  return false;
}

/** Convert SP's "MM/DD/YYYY HH:mm:ss" timestamp to ISO. Pass-through on
 * anything that's already ISO-ish or empty. */
function normalizeSpDate(raw: string): string {
  if (!raw) return "";
  const m = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const [, mm, dd, yyyy, hh = "0", min = "0", ss = "0"] = m;
    const d = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss),
    );
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  // Last resort: let the Date constructor try.
  const fallback = new Date(raw);
  if (!isNaN(fallback.getTime())) return fallback.toISOString();
  return raw;
}

/** Fetch running notes for a single ticket from ServicePower.
 *
 * Pulls from BOTH getCallNotes and getCallInfo. We expose the raw XML
 * from both responses so callers (e.g. the Squaretrade URL extractor)
 * can scan the entire payload — the Appointment Completion URL is
 * sometimes tucked into SpecialInstructions / ProblemDesc / a
 * vendor-specific field that we don't have a dedicated parser for, but
 * the URL itself is still in the XML and can be found via regex.
 */
export async function fetchServicePowerNotes(callNo: string): Promise<{
  success: boolean;
  notes: ServicePowerNote[];
  error?: string;
  /** Raw XML from the getCallNotes operation. */
  rawXml?: string;
  /** Raw XML from the getCallInfo operation (work-order details). */
  rawCallInfoXml?: string;
}> {
  if (!callNo) return { success: false, notes: [], error: "callNo required" };
  // Feed every call into the central health watcher so a stuck SP
  // tenant fires an admin notification once we see three failures in
  // a row from the running-notes endpoint specifically.
  const { reportApiHealth } = await import("./apiHealth");
  try {
    // Primary read: getCallNotes operation.
    const primaryResp = await fetch("/api/servicepower", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getCallNotes", params: { callNo } }),
    });
    let primaryError: string | undefined;
    let primaryNotes: ServicePowerNote[] = [];
    let primaryXml = "";
    if (primaryResp.ok) {
      const result = await primaryResp.json();
      primaryXml = String(result.xml ?? "");
      const parsed = parseGetCallNotesResponse(primaryXml);
      primaryNotes = parsed.notes;
      primaryError = parsed.error;
    } else {
      const err = await safeJson(primaryResp);
      primaryError = err?.error || `HTTP ${primaryResp.status}`;
    }

    // Secondary read: getCallInfo. SP embeds work-order details (problem
    // description, special instructions, manufacturer URLs) in this
    // payload — we capture the raw XML so the URL extractor can scan
    // it, and we still try to parse it as a notes block for any
    // <RemarksCollection> SP includes there.
    let extraNotes: ServicePowerNote[] = [];
    let callInfoXml = "";
    try {
      const ciResp = await fetch("/api/servicepower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getCallInfo", params: { callNo } }),
      });
      if (ciResp.ok) {
        const ciResult = await ciResp.json();
        callInfoXml = String(ciResult.xml ?? "");
        const parsedCi = parseGetCallNotesResponse(callInfoXml);
        extraNotes = parsedCi.notes;
      }
    } catch {
      // Best-effort; never fatal.
    }

    // Merge + de-dupe by (date | body | addedBy).
    const seen = new Set<string>();
    const merged: ServicePowerNote[] = [];
    for (const n of [...primaryNotes, ...extraNotes]) {
      const key = `${n.date}::${n.addedBy}::${n.body}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(n);
    }
    merged.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    const ok = !primaryError || merged.length > 0;
    reportApiHealth(
      "servicePower.fetchNotes",
      ok ? "ok" : { error: primaryError || "no notes" },
    );
    return {
      success: ok,
      notes: merged,
      error: merged.length === 0 ? primaryError : undefined,
      rawXml: primaryXml,
      rawCallInfoXml: callInfoXml,
    };
  } catch (e) {
    reportApiHealth(
      "servicePower.fetchNotes",
      { error: e instanceof Error ? e.message : String(e) },
    );
    return { success: false, notes: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Push a new running note to ServicePower for a given call. */
export async function addServicePowerNote(input: {
  callNo: string;
  note: string;
  addedBy?: string;
  isInternal?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const callNo = String(input.callNo ?? "").trim();
  const note = String(input.note ?? "").trim();
  if (!callNo || !note) return { success: false, error: "callNo and note are required" };
  try {
    const response = await fetch("/api/servicepower", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "addCallNote",
        params: {
          callNo,
          note,
          addedBy: input.addedBy ?? "",
          isInternal: typeof input.isInternal === "boolean" ? input.isInternal : undefined,
        },
      }),
    });
    if (!response.ok) {
      const err = await safeJson(response);
      return { success: false, error: err?.error || `HTTP ${response.status}` };
    }
    const result = await response.json();
    // SP returns a SOAP envelope; check for an explicit error tag.
    const xml = String(result.xml ?? "");
    const errMatch = xml.match(/<(?:[A-Za-z][\w.-]*:)?ErrMessage[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w.-]*:)?ErrMessage>/i);
    if (errMatch && errMatch[1].trim()) {
      return { success: false, error: errMatch[1].trim() };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function safeJson(response: Response): Promise<any | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
