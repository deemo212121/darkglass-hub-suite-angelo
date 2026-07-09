/**
 * Per-model reference links shared across every ticket carrying the same
 * model number. Surfaced on the ticket detail's Product Information section
 * via two buttons: Exploded View and Service Bulletin.
 *
 * Backed by the `model_resources` table (migration 0019). Company-scoped via
 * RLS — every user in the company sees the same links.
 */
import { supabase } from "./client";

export interface ModelResources {
  model: string;
  explodedViewUrl: string;
  serviceBulletinUrl: string;
  updatedAt?: string;
}

const EMPTY: Omit<ModelResources, "model"> = {
  explodedViewUrl: "",
  serviceBulletinUrl: "",
};

function normalizeModel(value: string): string {
  return String(value || "").trim().toUpperCase();
}

/** Read the resources row for a model. Returns blanks if none exists. */
export async function getModelResources(model: string): Promise<ModelResources> {
  const key = normalizeModel(model);
  if (!key) return { model: "", ...EMPTY };

  const { data, error } = await supabase
    .from("model_resources")
    .select("model, exploded_view_url, service_bulletin_url, updated_at")
    .eq("model", key)
    .maybeSingle();

  if (error) {
    console.error("getModelResources error:", error.message);
    return { model: key, ...EMPTY };
  }
  if (!data) return { model: key, ...EMPTY };

  return {
    model: data.model,
    explodedViewUrl: data.exploded_view_url || "",
    serviceBulletinUrl: data.service_bulletin_url || "",
    updatedAt: data.updated_at,
  };
}

/**
 * Upsert resources for a model. Pass empty strings to clear a link. The DB
 * unique index on (company_id, model) makes this idempotent.
 */
export async function saveModelResources(
  model: string,
  fields: { explodedViewUrl?: string; serviceBulletinUrl?: string },
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
  if (fields.explodedViewUrl !== undefined) payload.exploded_view_url = fields.explodedViewUrl || null;
  if (fields.serviceBulletinUrl !== undefined) payload.service_bulletin_url = fields.serviceBulletinUrl || null;

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
