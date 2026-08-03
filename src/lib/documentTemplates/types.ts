/**
 * "Turn submissions into documents" — an optional PDF template per custom
 * form (see supabase/migrations/0078_hr_custom_forms_document_template.sql).
 * A template is just an ordered list of blocks; see
 * DocumentTemplateEditor.tsx for the designer and generate.ts for turning
 * one (plus a real submission's responses) into an actual PDF.
 *
 * Every block carries the exact same width/displayMode/style triple as a
 * CustomFormField (see src/lib/formElements/types.ts) — reused, not
 * duplicated — so a document block gets the same Style-tab depth (colors,
 * border, shadow, opacity, margin/padding, font) as a form field, and both
 * are rendered through the very same applyFieldStyle helper.
 *
 * A block can optionally carry a `position` — this takes it out of the
 * ordered stack entirely and "pins" it as a free-floating overlay on top of
 * the page (a real letterhead logo/date), draggable to any exact spot
 * instead of just up/down through the stack. Used today by the dedicated
 * Logo/Date buttons in DocumentTemplateEditor.tsx's palette.
 */
import { applyFieldStyle, type FieldDisplayMode, type FieldStyle, type FieldWidth } from "@/lib/formElements/types";
import type { CSSProperties } from "react";

export type DocumentBlockType = "heading" | "paragraph" | "image" | "fieldValue" | "divider" | "spacer" | "date";

export interface DocumentBlockPosition {
  x: number;
  y: number;
}

export interface DocumentBlock {
  id: string;
  type: DocumentBlockType;
  /** heading/paragraph — plain text containing {{field_name}} tokens, substituted per-submission at generation time. */
  text?: string;
  /** image — static, admin-uploaded via uploadCustomFormAsset (same helper the Image form element uses). */
  imageUrl?: string;
  /** fieldValue — which of the form's fields (by Unique Field Name) to render this submission's answer for. */
  fieldName?: string;
  /** fieldValue — prefix the value with "Label: " so a document reads naturally instead of a bare value. Defaults to true. */
  showLabel?: boolean;
  width: FieldWidth;
  displayMode: FieldDisplayMode;
  style: FieldStyle;
  /** When set, this block is "pinned" — rendered as a free-floating overlay at this x/y (px, relative to the page's printable area) instead of flowing through the ordered stack. */
  position?: DocumentBlockPosition;
}

export interface DocumentTemplate {
  blocks: DocumentBlock[];
}

/** US Letter page, matching the warningFormStyles/Certificate-of-Employment convention used elsewhere in the app. */
export const PAGE_WIDTH = 816;
export const PAGE_HEIGHT = 1056;
export const PAGE_PADDING = 72;
export const PAGE_CONTENT_WIDTH = PAGE_WIDTH - PAGE_PADDING * 2;
export const PAGE_CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING * 2;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "July 24, 2026" — the one date format used everywhere a document shows a date, so the builder's design-time preview and the real generated PDF always agree. */
export function formatDocumentDate(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * CSS for a pinned block's wrapper — used identically by the builder's
 * PinnedBlock (as a React inline style) and by generate.ts (serialized to a
 * CSS string for the raw HTML captured into a PDF), so a pinned block looks
 * the same in both. Reuses applyFieldStyle for every cosmetic property
 * (colors, border, shadow, opacity, font, margin, padding, alignment) but
 * overrides sizing and positioning: flexBasis only works inside a flex
 * parent, which a pinned block no longer has once taken out of flow via
 * `position: absolute`, so left/top come straight from the block's own
 * `position`, and width depends on displayMode — "block" sizes to a
 * percentage of the page's printable content area (right for an image or
 * anything that should occupy a deliberate amount of space), while
 * "shrink"/"inline" fit the box exactly to its own content (right for a
 * title/label, so there's no dead space trailing past the text — the Width
 * percentage buttons only matter in "block" mode, same convention flow
 * blocks already use).
 */
export function pinnedBlockStyle(block: DocumentBlock): CSSProperties {
  const base = applyFieldStyle(block);
  const pos = block.position ?? { x: 0, y: 0 };
  const width =
    block.displayMode === "block"
      ? `${(block.width / 100) * PAGE_CONTENT_WIDTH}px`
      : "fit-content";
  return {
    ...base,
    flexBasis: undefined,
    maxWidth: block.displayMode === "block" ? undefined : `${PAGE_CONTENT_WIDTH}px`,
    display: undefined,
    position: "absolute",
    left: `${pos.x}px`,
    top: `${pos.y}px`,
    width,
  };
}

let idCounter = 0;
export function newBlockId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}${idCounter}`;
}

export function defaultBlockFor(type: DocumentBlockType): DocumentBlock {
  const base: DocumentBlock = { id: newBlockId(), type, width: 100, displayMode: "block", style: {} };
  if (type === "heading") return { ...base, text: "Heading", style: { alignment: "left", fontSize: 20, fontWeight: "bold" } };
  if (type === "paragraph") return { ...base, text: "Paragraph text — click a variable to insert it.", style: { alignment: "left", fontSize: 12 } };
  if (type === "image") return { ...base, imageUrl: "" };
  if (type === "fieldValue") return { ...base, fieldName: "", showLabel: true, style: { fontSize: 12 } };
  if (type === "date") return { ...base, style: { fontSize: 12 } };
  return base;
}

/**
 * A Logo — a pinned Image block, defaulting to the page's top-left margin
 * (PAGE_PADDING in from the true edge on both axes, matching where flow
 * content's own left margin sits, rather than bleeding to the literal page
 * corner).
 */
export function defaultLogoBlock(): DocumentBlock {
  return { ...defaultBlockFor("image"), width: 25, position: { x: PAGE_PADDING, y: PAGE_PADDING } };
}

/** A Date — a pinned Date block, defaulting to the page's top-right margin, right-aligned within its own box so it stays flush right if resized. */
export function defaultDateBlock(): DocumentBlock {
  const width: FieldWidth = 33;
  const widthPx = (width / 100) * PAGE_CONTENT_WIDTH;
  return { ...defaultBlockFor("date"), width, style: { fontSize: 11, alignment: "right" }, position: { x: PAGE_WIDTH - PAGE_PADDING - widthPx, y: PAGE_PADDING } };
}

/** A ready-to-use fieldValue block for one of the form's fields (by Unique Field Name) — used both to auto-seed a brand new template with every field and by "Add missing fields" to catch up later. */
export function fieldValueBlockFor(fieldName: string): DocumentBlock {
  return { ...defaultBlockFor("fieldValue"), fieldName };
}

/**
 * Documents saved before blocks carried width/displayMode/style used flat
 * align/fontSize/bold fields instead — this fills in today's shape from
 * whatever's actually in storage, migrating those legacy fields into
 * `style` so old designs keep their original look instead of throwing on
 * the now-required properties. Called wherever a stored template's blocks
 * are read: the builder (CustomFormBuilder.tsx) and the PDF generator
 * (generate.ts).
 */
export function normalizeDocumentBlock(raw: Record<string, any>): DocumentBlock {
  const style: FieldStyle = raw.style ?? {
    alignment: raw.align,
    fontSize: raw.fontSize,
    fontWeight: raw.bold === false ? "normal" : raw.bold === true ? "bold" : undefined,
  };
  return {
    id: raw.id,
    type: raw.type,
    text: raw.text,
    imageUrl: raw.imageUrl,
    fieldName: raw.fieldName,
    showLabel: raw.showLabel,
    width: raw.width ?? 100,
    displayMode: raw.displayMode ?? "block",
    style,
    position: raw.position,
  };
}

export const BLOCK_TYPE_LABELS: Record<DocumentBlockType, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  image: "Image",
  fieldValue: "Field Value",
  divider: "Divider",
  spacer: "Spacer",
  date: "Date",
};
