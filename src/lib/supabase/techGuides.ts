/**
 * Tech Tips / Repair Guides data (migration 0328) — see src/lib/techGuides.ts.
 */
import { supabase } from "./client";
import { DEFAULT_TECH_GUIDES, type TechGuide } from "@/lib/techGuides";

export interface TechGuideWithMeta extends TechGuide {
  /** true when this company has saved its own version (false = built-in default). */
  customized: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

function rowToGuide(r: any): TechGuideWithMeta {
  return {
    key: r.guide_key,
    title: r.title,
    productCategories: r.product_categories ?? [],
    intro: r.intro ?? "",
    sections: Array.isArray(r.sections) ? r.sections : [],
    readings: Array.isArray(r.readings) ? r.readings : [],
    customized: true,
    updatedByName: r.updated_by_name ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

/**
 * The company's guides: built-in defaults, each replaced by the company's
 * saved version when one exists, plus any extra guides the company added.
 * If the table isn't there yet (0328 not applied), the defaults alone.
 */
export async function getTechGuides(): Promise<TechGuideWithMeta[]> {
  const { data, error } = await supabase
    .from("tech_guides")
    .select("guide_key, title, product_categories, intro, sections, readings, updated_by_name, updated_at");
  if (error) console.warn("getTechGuides — using built-in guides:", error.message);
  const saved = new Map((data ?? []).map((r: any) => [r.guide_key as string, rowToGuide(r)]));
  const merged: TechGuideWithMeta[] = DEFAULT_TECH_GUIDES.map(
    (g) => saved.get(g.key) ?? { ...g, customized: false, updatedByName: null, updatedAt: null },
  );
  for (const [key, g] of saved) if (!DEFAULT_TECH_GUIDES.some((d) => d.key === key)) merged.push(g);
  return merged;
}

export async function saveTechGuide(guide: TechGuide, editorName: string): Promise<void> {
  const { error } = await supabase.from("tech_guides").upsert(
    {
      guide_key: guide.key,
      title: guide.title,
      product_categories: guide.productCategories,
      intro: guide.intro,
      sections: guide.sections,
      readings: guide.readings,
      updated_by_name: editorName || null,
    },
    { onConflict: "company_id,guide_key" },
  );
  if (error) throw new Error(error.message);
}

/** Removes the company's saved copy — a built-in guide goes back to its default; an added guide is deleted. */
export async function deleteTechGuide(guideKey: string): Promise<void> {
  const { error } = await supabase.from("tech_guides").delete().eq("guide_key", guideKey);
  if (error) throw new Error(error.message);
}

export interface GuideReadings {
  visitId: string;
  guideKey: string;
  values: Record<string, string | boolean>;
  updatedByName: string | null;
  updatedAt: string | null;
}

/** Every visit's recorded readings for a ticket. */
export async function getTicketGuideReadings(ticketId: string): Promise<GuideReadings[]> {
  const { data, error } = await supabase
    .from("ticket_guide_readings")
    .select("visit_id, guide_key, values, updated_by_name, updated_at")
    .eq("ticket_id", ticketId);
  if (error) {
    console.warn("getTicketGuideReadings:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    visitId: r.visit_id,
    guideKey: r.guide_key,
    values: r.values ?? {},
    updatedByName: r.updated_by_name ?? null,
    updatedAt: r.updated_at ?? null,
  }));
}

export async function saveTicketGuideReadings(
  ticketId: string,
  visitId: string,
  guideKey: string,
  values: Record<string, string | boolean>,
  editorName: string,
): Promise<void> {
  const { error } = await supabase.from("ticket_guide_readings").upsert(
    { ticket_id: ticketId, visit_id: visitId, guide_key: guideKey, values, updated_by_name: editorName || null },
    { onConflict: "visit_id,guide_key" },
  );
  if (error) throw new Error(error.message);
}
