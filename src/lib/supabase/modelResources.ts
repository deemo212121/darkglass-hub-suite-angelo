/**
 * Per-model reference links shared across every ticket carrying the same
 * model number. Surfaced on the ticket detail's Product Information section
 * via three buttons: Exploded View, Service Bulletin, and Tech Data Sheet.
 * Each field can hold multiple links.
 *
 * Backed by the `model_resources` table (migration 0019, arrays added in
 * 0311). Company-scoped via RLS — every user in the company sees the same
 * links.
 */
import { supabase } from "./client";

export interface ModelResources {
  model: string;
  explodedViewUrls: string[];
  serviceBulletinUrls: string[];
  techDataSheetUrls: string[];
  updatedAt?: string;
}

const EMPTY: Omit<ModelResources, "model"> = {
  explodedViewUrls: [],
  serviceBulletinUrls: [],
  techDataSheetUrls: [],
};

function normalizeModel(value: string): string {
  return String(value || "").trim().toUpperCase();
}

function normalizeUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || "").trim()).filter(Boolean);
}

/** Read the resources row for a model. Returns blanks if none exists. */
export async function getModelResources(model: string): Promise<ModelResources> {
  const key = normalizeModel(model);
  if (!key) return { model: "", ...EMPTY };

  const { data, error } = await supabase
    .from("model_resources")
    .select("model, exploded_view_urls, service_bulletin_urls, tech_data_sheet_urls, updated_at")
    .eq("model", key)
    .maybeSingle();

  if (error) {
    console.error("getModelResources error:", error.message);
    return { model: key, ...EMPTY };
  }
  if (!data) return { model: key, ...EMPTY };

  return {
    model: data.model,
    explodedViewUrls: normalizeUrls(data.exploded_view_urls),
    serviceBulletinUrls: normalizeUrls(data.service_bulletin_urls),
    techDataSheetUrls: normalizeUrls(data.tech_data_sheet_urls),
    updatedAt: data.updated_at,
  };
}

/**
 * Upsert resources for a model. Pass an empty array to clear a field. The DB
 * unique index on (company_id, model) makes this idempotent.
 */
export async function saveModelResources(
  model: string,
  fields: { explodedViewUrls?: string[]; serviceBulletinUrls?: string[]; techDataSheetUrls?: string[] },
): Promise<ModelResources> {
  const key = normalizeModel(model);
  if (!key) throw new Error("saveModelResources requires a model");

  // Look up first so we can update by id (cleaner audit + avoids the unique
  // conflict surface).
  const { data: existing } = await supabase
    .from("model_resources")
    .select("id")
    .eq("model", key)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (fields.explodedViewUrls !== undefined) payload.exploded_view_urls = normalizeUrls(fields.explodedViewUrls);
  if (fields.serviceBulletinUrls !== undefined) payload.service_bulletin_urls = normalizeUrls(fields.serviceBulletinUrls);
  if (fields.techDataSheetUrls !== undefined) payload.tech_data_sheet_urls = normalizeUrls(fields.techDataSheetUrls);

  if (existing?.id) {
    const { error } = await supabase
      .from("model_resources")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("model_resources")
      .insert({ model: key, ...payload });
    if (error) throw new Error(error.message);
  }

  return getModelResources(key);
}
