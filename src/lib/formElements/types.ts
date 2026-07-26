/**
 * The Form Maker's element registry — one ElementDefinition per palette
 * item (Short Text, Star Rating, Page Break, ...). This is the whole
 * "modular" story: CustomFormBuilder.tsx and CustomFormRenderer.tsx never
 * switch on `field.type` themselves — they look the type up in
 * ELEMENT_REGISTRY (see index.ts) and call whichever component they need.
 * Adding a brand new element type later means writing one more
 * ElementDefinition and adding it to a category list in index.ts; nothing
 * else in the builder or renderer has to change.
 */
import type { ComponentType, CSSProperties } from "react";

export type ElementCategory = "basic" | "basicInputs" | "survey" | "page";

export type ConditionOperator = "equals" | "notEquals" | "contains" | "greaterThan" | "lessThan" | "isEmpty" | "isNotEmpty";

export interface FieldCondition {
  fieldName: string;
  operator: ConditionOperator;
  value?: string;
}

export interface ConditionalLogic {
  action: "show" | "hide" | "enable" | "disable";
  match: "all" | "any";
  conditions: FieldCondition[];
}

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  regex?: string;
  errorMessage?: string;
  /** A restricted-expression-language boolean check — see expressions.ts. Never eval()'d or run as real JS. */
  customExpression?: string;
}

export interface FieldStyle {
  margin?: string;
  padding?: string;
  alignment?: "left" | "center" | "right";
  borderRadius?: number;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  shadow?: boolean;
  opacity?: number;
}

export interface FieldAdvanced {
  tabIndex?: number;
  ariaLabel?: string;
  devNotes?: string;
  customAttributes?: Record<string, string>;
}

export type FieldWidth = 25 | 33 | 50 | 66 | 75 | 100;
export type FieldDisplayMode = "block" | "inline" | "shrink";

export interface CustomFormField {
  id: string;
  type: string;
  /** Human-readable "Unique Field Name" — what conditional-logic/calculation expressions reference (readable, unlike the opaque id). Auto-slugged from label, editable, must be unique within the form. */
  name: string;
  label: string;
  description?: string;
  helpText?: string;
  tooltip?: string;
  placeholder?: string;
  required: boolean;
  /** Permanently hidden (never rendered) — distinct from conditionalLogic's runtime "hide". */
  hidden: boolean;
  readonly: boolean;
  defaultValue?: any;
  width: FieldWidth;
  displayMode: FieldDisplayMode;
  style: FieldStyle;
  cssClass?: string;
  validation: FieldValidation;
  conditionalLogic: ConditionalLogic | null;
  /** A restricted-expression-language formula — when set, this field's displayed value is computed from other fields and read-only. */
  calculation?: string;
  advanced: FieldAdvanced;
  /** Type-specific settings, shaped however that element needs (options list, min/max, table columns, product catalog, ...). */
  config: Record<string, any>;
}

export interface CanvasPreviewProps {
  field: CustomFormField;
  config: Record<string, any>;
}

export interface PropertiesPanelProps {
  field: CustomFormField;
  /** All OTHER fields currently on the form — used by e.g. Fill in the Blank's variable chips. */
  allFields: CustomFormField[];
  onChange: (field: CustomFormField) => void;
}

export interface FillInputProps {
  field: CustomFormField;
  value: any;
  onChange: (value: any) => void;
}

export interface ElementDefinition {
  type: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  category: ElementCategory;
  /** "structural" elements collect no value (Heading, Divider, Image, Section Collapse, Page Break) — required/validation don't apply to them. Submit Button is structural but does drive the submit action. */
  kind: "field" | "structural";
  defaultConfig: () => Record<string, any>;
  CanvasPreview: ComponentType<CanvasPreviewProps>;
  PropertiesPanel: ComponentType<PropertiesPanelProps>;
  FillInput: ComponentType<FillInputProps>;
  /** Generalized required-field check — different types have different "empty" shapes (string vs array vs grid). */
  isEmptyValue: (value: any) => boolean;
  /** True for elements whose FillInput value is a File (or resolves to one) rather than plain data — Signature, File Upload. Drives upload handling in the fill pages. */
  isFileField?: boolean;
  /** Optional extra type-specific validation beyond the generic required/min/max/regex layers (e.g. Email's Allowed/Blocked Domains) — returns an error message, or null if valid. */
  validateValue?: (value: any, field: CustomFormField) => string | null;
  /** Optional "make this value human-readable as one line of plain text" — used by the submissions table/modal and document generation for composite values (Full Name, Address, Product List, ...) so they read naturally instead of a generic key: value dump. Takes the field too (not just the value) since some types — Product List's quantities — need their own config (the product catalog) to resolve into names. Falls back to a generic stringifier when not provided. */
  formatValue?: (value: any, field: CustomFormField) => string;
}

export const CATEGORY_LABELS: Record<ElementCategory, string> = {
  basic: "Basic",
  basicInputs: "Basic Inputs",
  survey: "Survey",
  page: "Page",
};

let idCounter = 0;
/** Short, unique-enough id for a field within one form. */
export function newFieldId(): string {
  idCounter += 1;
  return `f${Date.now().toString(36)}${idCounter}`;
}

export function defaultEmptyCheck(value: any): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) || value === false;
}

export function slugifyFieldName(label: string, fallback: string): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return base || fallback;
}

/** Appends a numeric suffix until `candidate` doesn't collide with any name in `existing`. */
export function uniqueFieldName(candidate: string, existing: string[]): string {
  if (!existing.includes(candidate)) return candidate;
  let i = 2;
  while (existing.includes(`${candidate}_${i}`)) i += 1;
  return `${candidate}_${i}`;
}

/**
 * Translates a width/displayMode/style triple into real inline CSS — used
 * identically by the form builder's canvas preview, the real fill-out
 * renderer, and the document template designer/generator (DocumentBlock
 * has the exact same three properties, deliberately, so a document block
 * gets the same styling power as a form field), so what you configure is
 * what fillers/documents actually show. Takes a structural subset rather
 * than the full CustomFormField so any object shaped like `{width,
 * displayMode, style}` can use it.
 */
export function applyFieldStyle(field: { width: FieldWidth; displayMode: FieldDisplayMode; style: FieldStyle }): CSSProperties {
  const s = field.style ?? {};
  const style: CSSProperties = {
    flexBasis: field.displayMode === "block" ? `${field.width}%` : undefined,
    maxWidth: field.displayMode === "block" ? `${field.width}%` : undefined,
    display: field.displayMode === "inline" ? "inline-block" : undefined,
    width: field.displayMode === "shrink" ? "fit-content" : undefined,
    margin: s.margin,
    padding: s.padding,
    textAlign: s.alignment,
    borderRadius: s.borderRadius != null ? `${s.borderRadius}px` : undefined,
    backgroundColor: s.backgroundColor || undefined,
    borderColor: s.borderColor || undefined,
    borderWidth: s.borderColor ? "1px" : undefined,
    borderStyle: s.borderColor ? "solid" : undefined,
    color: s.textColor || undefined,
    fontSize: s.fontSize != null ? `${s.fontSize}px` : undefined,
    fontWeight: s.fontWeight,
    boxShadow: s.shadow ? "0 2px 8px rgba(0,0,0,0.15)" : undefined,
    opacity: s.opacity != null ? s.opacity : undefined,
  };
  return style;
}

export function defaultCustomFormField(type: string, def: Pick<ElementDefinition, "defaultConfig" | "kind">, existingNames: string[]): CustomFormField {
  const name = uniqueFieldName(slugifyFieldName(type, type), existingNames);
  return {
    id: newFieldId(),
    type,
    name,
    label: "",
    required: false,
    hidden: false,
    readonly: false,
    width: 100,
    displayMode: "block",
    style: {},
    validation: {},
    conditionalLogic: null,
    advanced: {},
    config: def.defaultConfig(),
  };
}
