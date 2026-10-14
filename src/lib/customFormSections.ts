/**
 * A custom form's "Filled in by: Company" part, split into signer sections —
 * a new section starts at each company Heading (e.g. "Company / Employer",
 * then "Human Resources"). Each signer completes just their own section, at
 * their own time; the submission stays "Awaiting company signature" until
 * every section is done (see CustomFormsPanel's Complete and
 * CustomFormRenderer's company mode). A form with one company section (or no
 * company heading) behaves exactly as a single Complete step.
 */
import { ELEMENT_REGISTRY, type CustomFormField } from "@/lib/formElements";

export interface SignerSection {
  /** The company Heading that starts this section — null for company fields before any heading. */
  heading: CustomFormField | null;
  fields: CustomFormField[];
}

export function splitSignerSections(companyFields: CustomFormField[]): SignerSection[] {
  const sections: SignerSection[] = [];
  for (const f of companyFields) {
    if (f.type === "heading" || !sections.length) sections.push({ heading: f.type === "heading" ? f : null, fields: [] });
    sections[sections.length - 1].fields.push(f);
  }
  return sections;
}

/** Who signs the section — its signer's name (e.g. "Justin Lee"), else its heading's text (e.g. "HUMAN RESOURCES"). */
export function signerSectionName(section: SignerSection): string {
  return String(section.heading?.config?.signer?.name ?? "").trim() || String(section.heading?.config?.text ?? "").trim() || "Company";
}

/**
 * Whether a value counts as answered. A signature/upload is a File while it's
 * being filled in, and a saved { url } afterwards — the element's own
 * isEmptyValue only knows the File form, so a saved one is checked here.
 */
export function hasAnswer(field: CustomFormField, value: unknown): boolean {
  const def = ELEMENT_REGISTRY[field.type];
  if (!def || def.kind === "structural") return false;
  if (def.isFileField) return value instanceof File || (!!value && typeof value === "object" && "url" in (value as object));
  return !def.isEmptyValue(value);
}

/** Every required field in the section has an answer. */
export function isSignerSectionComplete(section: SignerSection, values: Record<string, unknown>): boolean {
  return section.fields.every((f) => f.hidden || !f.required || ELEMENT_REGISTRY[f.type]?.kind === "structural" || hasAnswer(f, values[f.id]));
}

/**
 * Who may sign a section — set on its company Heading as config.signer
 * (e.g. { profileIds: [Justin Lee's id], name: "Justin Lee" } or
 * { roles: ["HR"], name: "HR" }). No signer = anyone completing the form.
 */
export interface SectionSigner {
  profileIds?: string[];
  roles?: string[];
  /** Shown to everyone else, e.g. "Waiting for Justin Lee to sign." */
  name?: string;
}

/** The person completing the form: their profile id and real role(s). */
export interface CurrentSigner {
  profileId: string | null;
  roles: string[];
}

export function sectionSigner(section: SignerSection): SectionSigner | null {
  const s = section.heading?.config?.signer;
  return s && (s.profileIds?.length || s.roles?.length) ? s : null;
}

/** Whether this person may sign the section (always, when it names no signer). Unknown person = only unrestricted sections. */
export function canSignSection(section: SignerSection, me: CurrentSigner | null | undefined): boolean {
  const s = sectionSigner(section);
  if (!s) return true;
  if (!me) return false;
  if (me.profileId && s.profileIds?.includes(me.profileId)) return true;
  const mine = new Set(me.roles.map((r) => r.toUpperCase()));
  return !!s.roles?.some((r) => mine.has(r.toUpperCase()));
}
