/**
 * Word (.docx) export of a custom form — a submission, or the blank form
 * itself — built natively with the `docx` library (same approach as
 * warningFormDocx.ts etc.), so it opens as a real editable Word document.
 * Follows the automatic PDF layout in generate.ts: company logo, the
 * form's own headings and paragraphs as written, then every answer on a
 * line with its label underneath, signatures as images, page numbers in
 * the footer. Client-side only (DOM parsing for rich text, image proxy).
 */
import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
} from "docx";
import { ELEMENT_REGISTRY, type CustomFormField } from "@/lib/formElements";
import type { CustomForm, CustomFormResponseValue, CustomFormSubmission } from "@/lib/supabase/customForms";
import { DISPLAY_TYPES, HEADING_SIZES, SKIPPED_IN_DOCUMENT, fillDisplayHtml, formatFieldValue, loadDocumentLogo, toDataUrl } from "./generate";

const INK = "111827";
const MUTED = "4B5563";
const BODY = 21; // half-points (10.5pt)
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_TABLE_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };
const NO_CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const SIGN_LINE = { bottom: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 2 } };
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };

type Fmt = { bold?: boolean; italics?: boolean; underline?: boolean };

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

function isFileValue(value: CustomFormResponseValue | undefined): value is { url: string; fileName?: string; mimeType?: string } {
  return !!value && typeof value === "object" && !Array.isArray(value) && "url" in (value as any);
}

function fillTokens(text: string, valuesByName: Record<string, CustomFormResponseValue>, fieldsByName: Record<string, CustomFormField>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name: string) => formatFieldValue(valuesByName[name], fieldsByName[name]));
}

/** Inline rich text (strong/b, em/i, u, br, text) → Word runs. */
function inlineRuns(node: Node, fmt: Fmt, size: number, color: string): TextRun[] {
  const runs: TextRun[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) runs.push(new TextRun({ text, bold: fmt.bold, italics: fmt.italics, underline: fmt.underline ? {} : undefined, size, color }));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (child as Element).tagName.toLowerCase();
    if (tag === "br") {
      runs.push(new TextRun({ break: 1, size }));
      return;
    }
    runs.push(
      ...inlineRuns(child, { bold: fmt.bold || tag === "strong" || tag === "b", italics: fmt.italics || tag === "em" || tag === "i", underline: fmt.underline || tag === "u" }, size, color)
    );
  });
  return runs;
}

/** A Heading / Paragraph / Divider element → Word paragraphs. */
function displayParagraphs(field: CustomFormField, valuesByName: Record<string, CustomFormResponseValue>, fieldsByName: Record<string, CustomFormField>): Paragraph[] {
  const c = field.config ?? {};
  const alignment = ALIGN[c.alignment] ?? AlignmentType.LEFT;
  const color = typeof c.color === "string" && c.color.startsWith("#") ? c.color.slice(1) : INK;
  if (field.type === "divider") {
    return [new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1", space: 1 } }, children: [] })];
  }
  if (field.type === "heading") {
    const px = c.fontSize || HEADING_SIZES[c.level || 3] || 16;
    return [
      new Paragraph({
        alignment,
        spacing: { before: 60, after: 160 },
        children: [new TextRun({ text: fillTokens(c.text || "", valuesByName, fieldsByName), bold: c.bold !== false, italics: !!c.italic, underline: c.underline ? {} : undefined, size: Math.round(px * 1.75), color })],
      }),
    ];
  }
  const size = c.fontSize ? Math.round(c.fontSize * 1.75) : BODY;
  if (c.html) {
    const holder = document.createElement("div");
    holder.innerHTML = fillDisplayHtml(c.html, valuesByName, fieldsByName);
    const out: Paragraph[] = [];
    holder.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) out.push(new Paragraph({ alignment, spacing: { after: 120 }, children: [new TextRun({ text, size, color })] }));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        Array.from(el.children).forEach((li, i) => {
          out.push(new Paragraph({ alignment, indent: { left: 360, hanging: 240 }, spacing: { after: 60 }, children: [new TextRun({ text: tag === "ol" ? `${i + 1}. ` : "• ", size, color }), ...inlineRuns(li, {}, size, color)] }));
        });
        return;
      }
      out.push(new Paragraph({ alignment, spacing: { after: 120 }, children: inlineRuns(el, { bold: /^h[1-6]$/.test(tag) }, size, color) }));
    });
    return out;
  }
  return String(c.text || "")
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => new Paragraph({ alignment, spacing: { after: 120 }, children: fillTokens(p, valuesByName, fieldsByName).split("\n").map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined, size, color })) }));
}

/** One answer cell: the value (or signature image) on a line, its label underneath. */
async function answerCell(field: CustomFormField, value: CustomFormResponseValue | undefined, width: number): Promise<TableCell> {
  let line: Paragraph;
  if (ELEMENT_REGISTRY[field.type]?.isFileField && isFileValue(value)) {
    const mime = value.mimeType || (value.url.startsWith("data:image/png") ? "image/png" : "");
    const kind = /png/i.test(mime) || field.type === "signature" ? "png" : /jpe?g/i.test(mime) ? "jpg" : null;
    if (kind) {
      const bytes = await dataUrlToBytes(await toDataUrl(value.url));
      line = new Paragraph({ border: SIGN_LINE, children: [new ImageRun({ type: kind, data: bytes, transformation: field.type === "signature" ? { width: 180, height: 60 } : { width: 160, height: 120 } })] });
    } else {
      line = new Paragraph({ border: SIGN_LINE, children: [new TextRun({ text: value.fileName || "Attachment", size: BODY, color: INK })] });
    }
  } else if (ELEMENT_REGISTRY[field.type]?.isFileField) {
    line = new Paragraph({ border: SIGN_LINE, spacing: { before: 600 }, children: [] }); // blank signing space
  } else {
    line = new Paragraph({ border: SIGN_LINE, spacing: { before: 200 }, children: [new TextRun({ text: formatFieldValue(value ?? null, field) || " ", size: BODY, color: INK })] });
  }
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    borders: NO_CELL_BORDERS,
    verticalAlign: VerticalAlign.BOTTOM,
    margins: { top: 0, bottom: 0, left: 0, right: 280 },
    children: [line, new Paragraph({ spacing: { before: 40, after: 160 }, children: [new TextRun({ text: field.label || field.name, size: 18, color: MUTED })] })],
  });
}

export async function generateSubmissionDocx(form: Pick<CustomForm, "title" | "fields">, submission: Pick<CustomFormSubmission, "responses">): Promise<Blob> {
  const valuesByName: Record<string, CustomFormResponseValue> = {};
  const fieldsByName: Record<string, CustomFormField> = {};
  for (const f of form.fields) {
    valuesByName[f.name] = submission.responses[f.id] ?? null;
    fieldsByName[f.name] = f;
  }
  const fields = form.fields.filter((f) => !f.hidden && !SKIPPED_IN_DOCUMENT.has(f.type));
  const body: (Paragraph | Table)[] = [];

  const logo = await loadDocumentLogo();
  if (logo) body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new ImageRun({ type: "png", data: await dataUrlToBytes(logo), transformation: { width: 64, height: 64 } })] }));
  if (!fields.some((f) => f.type === "heading")) {
    body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: form.title, bold: true, size: 28, color: INK })] }));
  }

  // Answers sharing a line (e.g. Signature 50% | Date 50%) become one borderless table row.
  let row: { field: CustomFormField; width: number }[] = [];
  const flushRow = async () => {
    if (row.length === 0) return;
    const used = row.reduce((sum, r) => sum + r.width, 0);
    const cells = await Promise.all(row.map((r) => answerCell(r.field, valuesByName[r.field.name], r.width)));
    if (used < 100) cells.push(new TableCell({ width: { size: 100 - used, type: WidthType.PERCENTAGE }, borders: NO_CELL_BORDERS, children: [new Paragraph({ children: [] })] }));
    body.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_TABLE_BORDERS, rows: [new TableRow({ children: cells })] }));
    row = [];
  };
  for (const field of fields) {
    if (DISPLAY_TYPES.has(field.type)) {
      await flushRow();
      body.push(...displayParagraphs(field, valuesByName, fieldsByName));
      continue;
    }
    const width = field.displayMode === "block" ? field.width ?? 100 : 100;
    if (row.reduce((sum, r) => sum + r.width, 0) + width > 100) await flushRow();
    row.push({ field, width });
  }
  await flushRow();

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial" } } } },
    sections: [
      {
        // US Letter (the docx default is A4), 1" side margins / 0.75" top & bottom.
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 16, color: "6B7280" })] })],
          }),
        },
        children: body,
      },
    ],
  });
  return Packer.toBlob(doc);
}
