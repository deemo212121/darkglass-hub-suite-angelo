import { supabase } from "./client";
import { toNewWageItem, type NewWageAdjustment, type NewWageItem } from "@/lib/newPromotions";

/**
 * HR's promotion forms and wage-increase letters (not cancelled), newest
 * first, each with Accounting's Adjusted mark (migration 0443). Light
 * select — no signatures. If 0443 hasn't been run yet the list still loads,
 * just without Adjusted marks.
 */
export async function getNewPromotionsAndWages(limit = 300): Promise<NewWageItem[]> {
  const [docs, marks] = await Promise.all([
    supabase
      .from("hr_signable_documents")
      .select("id, document_type, status, form_data, created_at, confirmed_at, pdf_url")
      .in("document_type", ["promotion_form", "compensation_update"])
      .in("status", ["pending_signature", "signed", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase.from("accounting_wage_adjustments").select("document_id, adjusted_by_name, adjusted_at"),
  ]);
  if (docs.error) throw new Error(docs.error.message);
  const adjusted = new Map<string, NewWageAdjustment>();
  for (const m of (marks.error ? [] : marks.data) ?? []) {
    adjusted.set((m as any).document_id, { byName: (m as any).adjusted_by_name ?? null, at: (m as any).adjusted_at });
  }
  return (docs.data ?? [])
    .map((r: any) =>
      toNewWageItem(
        {
          id: r.id,
          documentType: r.document_type,
          status: r.status,
          formData: r.form_data ?? {},
          createdAt: r.created_at,
          confirmedAt: r.confirmed_at ?? null,
          pdfUrl: r.pdf_url ?? null,
        },
        adjusted.get(r.id) ?? null,
      ),
    )
    .filter((x): x is NewWageItem => x !== null);
}

/**
 * How many completed papers still wait for Accounting's Adjusted mark (Home's
 * "New promotion need to adjust rate" card). Ids only — light enough for Home.
 */
export async function countWagesToAdjust(): Promise<number> {
  const [docs, marks] = await Promise.all([
    supabase
      .from("hr_signable_documents")
      .select("id")
      .in("document_type", ["promotion_form", "compensation_update"])
      .eq("status", "confirmed"),
    supabase.from("accounting_wage_adjustments").select("document_id"),
  ]);
  if (docs.error) throw new Error(docs.error.message);
  const done = new Set(((marks.error ? [] : marks.data) ?? []).map((m: any) => m.document_id as string));
  return (docs.data ?? []).filter((d: any) => !done.has(d.id)).length;
}

/** Accounting's Adjusted mark — on once the rate is changed in Payroll, off to undo. */
export async function setWageAdjusted(documentId: string, adjusted: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_wage_adjusted", { p_document_id: documentId, p_adjusted: adjusted });
  if (error) {
    if (/set_wage_adjusted|function .* does not exist|schema cache/i.test(error.message)) {
      throw new Error("Run migration 0443 in Supabase first.");
    }
    throw new Error(error.message);
  }
}
