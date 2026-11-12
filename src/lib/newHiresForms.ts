/**
 * Accounting Dashboard → "New Hires": everyone HIRED in a pay period
 * (Master List Hire Date inside it), with where their HR forms stand — W-4,
 * Direct Deposit and I-9 to start, any other HR form from the Forms
 * dropdown — so Payroll can pull each new hire's papers in one place instead
 * of opening Staff Form Checklist person by person. Read-only.
 *
 * Status per form uses the same rules as Staff Form Checklist
 * (getDocumentReviewStatus / pickAuthoritativeDocument), so the two always
 * agree; both the old and the New Automation copies of a form count.
 */
import { getDocumentReviewStatus, pickAuthoritativeDocument, SIGNABLE_DOCUMENT_REGISTRY, type DocumentReviewStatus } from "./signableDocumentRegistry";
import type { SignableDocumentStatus, SignableDocumentType } from "./supabase/signableDocuments";

/** Any HR form (hr_signable_documents type). */
export type HireFormType = SignableDocumentType;

/** Ticked when the list opens — what Payroll needs from a new hire. */
export const DEFAULT_HIRE_FORMS: HireFormType[] = ["w4", "direct_deposit", "i9"];

const SHORT_LABEL: Partial<Record<HireFormType, string>> = {
  w4: "W-4",
  direct_deposit: "Direct Deposit",
  i9: "I-9",
  w9: "W-9",
  w8ben: "W-8BEN",
  w4r: "W-4R",
};

export function hireFormLabel(type: HireFormType): string {
  return SHORT_LABEL[type] ?? SIGNABLE_DOCUMENT_REGISTRY[type]?.label ?? type;
}

/** Every HR form, A–Z by name — the Forms dropdown. */
export const ALL_HIRE_FORMS: HireFormType[] = (Object.keys(SIGNABLE_DOCUMENT_REGISTRY) as HireFormType[]).sort((a, b) =>
  hireFormLabel(a).localeCompare(hireFormLabel(b)),
);

export const HIRE_FORM_STATUS_LABEL: Record<DocumentReviewStatus, string> = {
  done: "Completed",
  awaiting_hr: "Awaiting HR",
  awaiting_employee: "Not signed yet",
  not_sent: "Not sent",
  outdated: "Old version",
};

/**
 * Same split as Staff Form Checklist: PH / Mexico by branch, then field
 * technicians, then everyone else in the US (office staff, managers).
 */
export type HireGroup = "US" | "TECH" | "PH" | "MX";

export const HIRE_GROUP_LABEL: Record<HireGroup, string> = {
  US: "US office",
  TECH: "Technicians",
  PH: "PH staff",
  MX: "Mexico staff",
};

/** W-4 / I-9 are US forms — the button's badge only counts these groups. */
export const US_HIRE_GROUPS = new Set<HireGroup>(["US", "TECH"]);

export interface HirePerson {
  id: string;
  name: string;
  role: string;
  branch: string;
  department: string;
  /** Master List Hire Date as stored (ISO or M/D/YYYY), or null. */
  hireDate: string | null;
  group: HireGroup;
}

export interface HireFormDoc {
  id: string;
  documentType: HireFormType;
  status: SignableDocumentStatus;
  recipientId: string;
  recipientSlot?: string;
  templateVersion?: string | null;
  pdfUrl: string | null;
  createdAt: string;
  signedAt: string | null;
  confirmedAt: string | null;
}

export interface HireFormCell {
  status: DocumentReviewStatus;
  doc: HireFormDoc | null;
}

export interface NewHireRow extends HirePerson {
  hireDay: string;
  /** Every form type, picked once from all of this person's documents. */
  forms: Partial<Record<HireFormType, HireFormCell>>;
}

/** "2026-11-10", "2026-11-10T…", "11/10/2026" → "2026-11-10"; anything else → null. */
export function parseHireDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

/** Hired inside the pay period, both ends included. */
export function hiredInPeriod(hireDay: string | null, start: string, end: string): boolean {
  return !!hireDay && !!start && !!end && hireDay >= start && hireDay <= end;
}

export function buildNewHireRows(people: HirePerson[], docs: HireFormDoc[], start: string, end: string): NewHireRow[] {
  const byPersonType = new Map<string, HireFormDoc[]>();
  for (const d of docs) {
    if (d.status === "cancelled") continue;
    const k = `${d.recipientId}|${d.documentType}`;
    (byPersonType.get(k) ?? byPersonType.set(k, []).get(k)!).push(d);
  }
  const rows: NewHireRow[] = [];
  for (const p of people) {
    const hireDay = parseHireDate(p.hireDate);
    if (!hireDay || !hiredInPeriod(hireDay, start, end)) continue;
    rows.push({ ...p, hireDay, forms: {} });
  }
  for (const r of rows) {
    for (const t of ALL_HIRE_FORMS) {
      const doc = pickAuthoritativeDocument(
        (byPersonType.get(`${r.id}|${t}`) ?? []).map((d) => ({ ...d, formData: { templateVersion: d.templateVersion } })),
      );
      r.forms[t] = {
        status: getDocumentReviewStatus(t, doc ? { documentType: t, status: doc.status, recipientSlot: doc.recipientSlot, formData: doc.formData } : undefined),
        doc: doc ?? null,
      };
    }
  }
  return rows.sort((a, b) => a.hireDay.localeCompare(b.hireDay) || a.name.localeCompare(b.name));
}

/** A row's cell for one form — "Not sent" when the person has none. */
export function hireFormCell(row: Pick<NewHireRow, "forms">, type: HireFormType): HireFormCell {
  return row.forms[type] ?? { status: "not_sent", doc: null };
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

/** "Juan Dela Cruz - W-4 (hired 2026-11-10).pdf" — safe for every OS. */
export function hireFormFileName(row: Pick<NewHireRow, "name" | "hireDay">, type: HireFormType): string {
  return `${safe(row.name) || "Employee"} - ${safe(hireFormLabel(type))} (hired ${row.hireDay}).pdf`;
}
