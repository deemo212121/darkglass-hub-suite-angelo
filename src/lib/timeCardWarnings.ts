/**
 * Time-card warnings on people's records — the Warning Forms HR sent for
 * time corrections. Shared by Absent List → Exceeded → Time Corrections (its
 * Warning Form column) and the attention badges (attention.ts), so someone
 * already warned for a month stops counting as "over the limit" everywhere.
 */
import type { SignableDocument } from "@/lib/supabase/signableDocuments";
import type { WarningFormData } from "@/lib/warningFormTemplate";

/**
 * Wording that marks a warning as being about time CORRECTIONS — "Time
 * Correction Requests", "…through the Timecard channel for correction",
 * "exceeded the correction limit". A plain time-card / attendance warning
 * (late, absent, left early) doesn't match.
 */
export const TIME_CARD_WORDS = /time\s*-?\s*corrections?|corrections?\s+requests?|time\s*-?\s*cards?\b[^.]{0,80}\bcorrect|exceed\w*\b[^.]{0,60}\bcorrections?/i;

/**
 * A Warning Form issued for time corrections — by what its Other reason /
 * description says (TIME_CARD_WORDS). HR's "Time Card Warning" category
 * alone isn't enough: it's also used for tardiness and absences.
 */
export function isTimeCardWarning(data: WarningFormData | undefined): boolean {
  if (!data) return false;
  return TIME_CARD_WORDS.test(`${data.reasons?.other ? data.reasons.otherText || "" : ""} ${data.description || ""}`);
}

/** Every MM/DD/YYYY (or YYYY-MM-DD) in a piece of text, as YYYY-MM-DD, in order. */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) {
    out.push(m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[4].padStart(2, "0")}-${m[5].padStart(2, "0")}`);
  }
  return out;
}

/**
 * One time-card warning on someone's record — a Warning Form itself, or a
 * "Previous Warning(s) Issued" line listed on one. `day` is what files it
 * under a month: the first date the warning is ABOUT (e.g. "07/02/2026,
 * 07/09/2026 – Exceeded…" → July), else the day it was issued.
 */
export interface TimeCardWarning {
  key: string;
  employeeId: string;
  day: string;
  issuedOn: string;
  level: string;
  issuedBy: string;
  text: string;
  status: string | null;
  /** The Warning Form — the warning itself, or the one its line is listed on. */
  doc: SignableDocument;
  fromPreviousList: boolean;
}

/**
 * Every time-card warning in a set of Warning Forms, one per person per day
 * (a form and a line listing it don't double up). Cancelled forms don't count.
 */
export function collectTimeCardWarnings(warningForms: SignableDocument[]): TimeCardWarning[] {
  const out: TimeCardWarning[] = [];
  const seen = new Set<string>();
  const add = (w: TimeCardWarning) => {
    const key = `${w.employeeId}|${w.day}`;
    if (!w.day || seen.has(key)) return;
    seen.add(key);
    out.push(w);
  };
  const forms = warningForms.filter((d) => d.status !== "cancelled");
  // The forms themselves first, so a listed line about the same day doesn't double it.
  for (const doc of forms) {
    const data = doc.formData as unknown as WarningFormData;
    if (!data?.employeeId || !isTimeCardWarning(data)) continue;
    const issuedOn = (data.warningDate || doc.createdAt || "").slice(0, 10);
    add({
      key: doc.id,
      employeeId: data.employeeId,
      day: datesIn(data.description || "")[0] ?? issuedOn,
      issuedOn,
      level: data.level || "",
      issuedBy: doc.createdByName || "",
      text: [data.reasons?.other ? data.reasons.otherText : "", data.description].filter(Boolean).join(" — "),
      status: doc.status,
      doc,
      fromPreviousList: false,
    });
  }
  for (const doc of forms) {
    const data = doc.formData as unknown as WarningFormData;
    if (!data?.employeeId) continue;
    (data.previousWarnings ?? []).forEach((pw, i) => {
      if (!pw?.cause || !TIME_CARD_WORDS.test(pw.cause)) return;
      const issuedOn = datesIn(pw.date || "")[0] ?? (pw.date || "").slice(0, 10);
      add({
        key: `${doc.id}:${i}`,
        employeeId: data.employeeId,
        day: datesIn(pw.cause)[0] ?? issuedOn,
        issuedOn,
        level: "",
        issuedBy: pw.issuedBy || "",
        text: pw.cause,
        status: null,
        doc,
        fromPreviousList: true,
      });
    });
  }
  return out;
}
