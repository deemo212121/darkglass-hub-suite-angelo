/**
 * The Form Maker's element registry. To add a new element type: write one
 * ElementDefinition (in whichever category file fits, or a new one) and
 * add its `type` key to the right spot in CATEGORIES below — nothing in
 * CustomFormBuilder.tsx or CustomFormRenderer.tsx needs to change.
 */
import type { ElementDefinition } from "./types";
import { BASIC_ELEMENTS } from "./basic";
import { BASIC_INPUTS_ELEMENTS } from "./basicInputs";
import { SURVEY_ELEMENTS } from "./survey";
import { PAGE_ELEMENTS } from "./page";

export * from "./types";
export * from "./expressions";

const ALL_ELEMENTS: ElementDefinition[] = [...BASIC_ELEMENTS, ...BASIC_INPUTS_ELEMENTS, ...SURVEY_ELEMENTS, ...PAGE_ELEMENTS];

export const ELEMENT_REGISTRY: Record<string, ElementDefinition> = Object.fromEntries(ALL_ELEMENTS.map((el) => [el.type, el]));

export const CATEGORIES: { key: string; label: string; types: string[] }[] = [
  { key: "basic", label: "Basic", types: BASIC_ELEMENTS.map((e) => e.type) },
  { key: "basicInputs", label: "Basic Inputs", types: BASIC_INPUTS_ELEMENTS.map((e) => e.type) },
  { key: "survey", label: "Survey", types: SURVEY_ELEMENTS.map((e) => e.type) },
  { key: "page", label: "Page", types: PAGE_ELEMENTS.map((e) => e.type) },
];

export function getElement(type: string): ElementDefinition | undefined {
  return ELEMENT_REGISTRY[type];
}

/** Basic shape validation before a form can be published. */
export function validateFormFields(fields: import("./types").CustomFormField[]): string | null {
  if (fields.length === 0) return "Add at least one field.";
  const seenNames = new Set<string>();
  for (const f of fields) {
    const def = ELEMENT_REGISTRY[f.type];
    if (!def) continue;
    if (def.kind === "field" && !f.label.trim()) return "Every field needs a label.";
    if (seenNames.has(f.name)) return `"${f.name}" is used as the Unique Field Name for more than one field — each must be unique.`;
    seenNames.add(f.name);
  }
  return null;
}
