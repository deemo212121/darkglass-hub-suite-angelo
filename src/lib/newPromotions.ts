/**
 * Accounting Dashboard → "New Promotion / New wage": every Employee
 * Promotion / Role Change form and Promotion Paper and Wage Increase letter
 * HR has sent (cancelled ones left out) — name, old → new position, new
 * wage, and whether it's still waiting on signatures or completed — so
 * Accounting knows whose rate to change. Accounting presses Adjusted once
 * the rate is changed in Payroll (migration 0443); nothing here touches
 * the rate history itself.
 *
 * The red badge counts papers sent or completed since this person last
 * opened the list (remembered on this device).
 */
import type { PromotionFormData } from "./promotionFormTemplate";
import type { CompensationUpdateFormData } from "./compensationUpdateTemplate";

export type NewWageKind = "promotion_form" | "compensation_update";
export type NewWageStatus = "pending_signature" | "signed" | "confirmed";

export interface NewWageDoc {
  id: string;
  documentType: NewWageKind;
  status: string;
  formData: Record<string, any>;
  createdAt: string;
  confirmedAt: string | null;
  pdfUrl: string | null;
}

export interface NewWageAdjustment {
  byName: string | null;
  at: string;
}

export interface NewWageItem {
  id: string;
  kind: NewWageKind;
  status: NewWageStatus;
  employeeName: string;
  oldPosition: string;
  newPosition: string;
  newWage: string;
  effectiveDate: string;
  createdAt: string;
  confirmedAt: string | null;
  pdfUrl: string | null;
  adjusted: NewWageAdjustment | null;
}

export const NEW_WAGE_KIND_LABEL: Record<NewWageKind, string> = {
  promotion_form: "Promotion Form",
  compensation_update: "Wage Increase",
};

export const NEW_WAGE_STATUS_LABEL: Record<NewWageStatus, string> = {
  pending_signature: "Pending signatures",
  signed: "Signed — awaiting HR confirmation",
  confirmed: "Completed",
};

// Same wording as promotionFormTemplate.ts's PROMOTION_WAGE_BASIS_LABEL (not imported: that file pulls in page-only code).
const WAGE_BASIS_LABEL: Record<string, string> = { hourly: "per hour", daily: "per day", monthly: "per month", yearly: "per year" };

const s = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const money = (v: string) => (v && /^\d/.test(v) ? `$${v}` : v);

export function toNewWageItem(doc: NewWageDoc, adjusted: NewWageAdjustment | null = null): NewWageItem | null {
  if (doc.status !== "pending_signature" && doc.status !== "signed" && doc.status !== "confirmed") return null;
  const base = {
    id: doc.id,
    kind: doc.documentType,
    status: doc.status as NewWageStatus,
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
    pdfUrl: doc.pdfUrl,
    adjusted,
  };
  if (doc.documentType === "promotion_form") {
    const f = doc.formData as Partial<PromotionFormData>;
    const basis = f.wageBasis ? WAGE_BASIS_LABEL[f.wageBasis] ?? "" : "";
    return {
      ...base,
      employeeName: s(f.employeeName),
      oldPosition: s(f.currentPosition),
      newPosition: s(f.newPositionTitle),
      newWage: [money(s(f.wageAmount)), basis].filter(Boolean).join(" "),
      effectiveDate: s(f.effectiveDate),
    };
  }
  const f = doc.formData as Partial<CompensationUpdateFormData>;
  const increase = money(s(f.salaryIncrease).replace(/^\+/, ""));
  return {
    ...base,
    employeeName: s(f.employeeName),
    oldPosition: "",
    newPosition: s(f.newPosition),
    newWage: [money(s(f.startingSalary)), increase ? `(+${increase})` : ""].filter(Boolean).join(" "),
    effectiveDate: s(f.effectiveDate),
  };
}

/**
 * Completed, not yet marked Adjusted by Accounting — Home's card and the
 * list's "To adjust" tab. Every completed paper counts, older ones too
 * (Accounting catches up on those and marks them).
 */
export function needsAdjusting(i: Pick<NewWageItem, "status" | "adjusted">): boolean {
  return i.status === "confirmed" && !i.adjusted;
}

/** The paper's latest change the badge cares about: sent, or completed. */
export const lastActivityAt = (i: Pick<NewWageItem, "createdAt" | "confirmedAt">) => i.confirmedAt ?? i.createdAt;

/** No "last opened" yet (first visit on this device) → the last 30 days count as new. */
export const FIRST_VISIT_DAYS = 30;

export function isNewSince(item: Pick<NewWageItem, "createdAt" | "confirmedAt">, seenAt: string | null, now = Date.now()): boolean {
  const t = Date.parse(lastActivityAt(item));
  if (isNaN(t)) return false;
  if (!seenAt) return t >= now - FIRST_VISIT_DAYS * 86400000;
  return t > Date.parse(seenAt);
}

const seenKey = (uid: string) => `ahs.newPromotionsWage.seenAt.${uid}`;

export function readSeenAt(uid: string | null): string | null {
  if (!uid) return null;
  try { return localStorage.getItem(seenKey(uid)); } catch { return null; }
}

export function writeSeenAt(uid: string | null, iso: string): void {
  if (!uid) return;
  try { localStorage.setItem(seenKey(uid), iso); } catch { /* private window — badge just won't remember */ }
}
