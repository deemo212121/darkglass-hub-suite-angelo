/**
 * Turns a DocumentTemplate + one real submission into an actual PDF —
 * "turn submissions into documents", the whole point of this module. Runs
 * entirely client-side (captureHtmlToPdfBlob needs a real DOM/canvas), so
 * this is only ever called from HR's own browser (CustomFormsPanel.tsx),
 * never from the serverless public-submission endpoint. Because it always
 * regenerates from the stored template + submission data on demand, adding
 * or editing a template later applies retroactively to old submissions —
 * nothing needs to be pre-rendered or cached.
 */
import DOMPurify from "dompurify";
import { formatDocumentDate, normalizeDocumentBlock, pinnedBlockStyle, PAGE_CONTENT_WIDTH, PAGE_HEIGHT, PAGE_PADDING, PAGE_WIDTH, type DocumentBlock, type DocumentTemplate } from "./types";
import type { CustomForm, CustomFormResponseValue, CustomFormSubmission } from "@/lib/supabase/customForms";
import { ELEMENT_REGISTRY, type CustomFormField } from "@/lib/formElements";
import { captureHtmlPagesToPdfBlob, captureHtmlToPdfBlob } from "@/lib/pdfCapture";
import type { CSSProperties } from "react";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Generic "make any stored response value readable" fallback for types with no ElementDefinition.formatValue — a plain key: value dump for whatever composite shape it turns out to be. */
function stringifyValue(value: CustomFormResponseValue | undefined): string {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) {
      return (value as unknown as string[][]).map((row) => row.join(", ")).join("; ");
    }
    return (value as unknown[]).filter((v) => v !== "" && v != null).join(", ");
  }
  if (typeof value === "object" && "url" in (value as any)) return (value as { fileName?: string }).fileName || "Attachment";
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

/** Prefers the field's own ElementDefinition.formatValue (Full Name → "First Last", Address → one line, Product List → item names) over the generic fallback above. */
export function formatFieldValue(value: CustomFormResponseValue | undefined, field: CustomFormField | undefined): string {
  const def = field && ELEMENT_REGISTRY[field.type];
  if (def?.formatValue && field) return def.formatValue(value, field);
  return stringifyValue(value);
}

const DISPLAY_TYPES = new Set(["heading", "paragraph", "divider"]);
const HEADING_SIZES: Record<number, number> = { 1: 24, 2: 20, 3: 16, 4: 14, 5: 13, 6: 12 };

/**
 * A display-only form element (Heading / Paragraph / Divider) as document
 * HTML — the form's own wording (e.g. an agreement's body text), which a
 * submission never stores since nobody "answers" it. {{field_name}} tokens
 * are filled from this submission's answers. Returns one string per
 * top-level paragraph/list so a long body can break across pages.
 */
function renderDisplayFieldHtml(field: CustomFormField, valuesByName: Record<string, CustomFormResponseValue>, fieldsByName: Record<string, CustomFormField>): string[] {
  const c = field.config ?? {};
  const align = c.alignment ? `text-align:${c.alignment};` : "";
  const color = c.color ? `color:${c.color};` : "";
  if (field.type === "divider") {
    return [`<hr style="border:0;border-top:${c.thickness ?? 1}px ${c.lineStyle || "solid"} ${c.color || "#cbd5e1"};margin:${c.spacing ?? 8}px 0;" />`];
  }
  if (field.type === "heading") {
    const size = c.fontSize || HEADING_SIZES[c.level || 3] || 16;
    const deco = `${c.italic ? "font-style:italic;" : ""}${c.underline ? "text-decoration:underline;" : ""}`;
    return [`<div style="font-size:${size}px;font-weight:${c.bold === false ? 400 : 700};${align}${color}${deco}margin:4px 0 10px;">${substituteTokens(c.text || "", valuesByName, fieldsByName)}</div>`];
  }
  const fontSize = c.fontSize ? `font-size:${c.fontSize}px;` : "";
  const wrapperStyle = `${align}${color}${fontSize}margin:0 0 8px;`;
  if (c.html) {
    const filled = String(c.html).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_: string, name: string) => escapeHtml(formatFieldValue(valuesByName[name], fieldsByName[name])));
    const holder = document.createElement("div");
    holder.innerHTML = DOMPurify.sanitize(filled);
    const parts: string[] = [];
    for (const node of Array.from(holder.childNodes)) {
      const html = node.nodeType === Node.ELEMENT_NODE ? (node as Element).outerHTML : escapeHtml(node.textContent ?? "");
      if (html.trim()) parts.push(`<div class="doc-rich" style="${wrapperStyle}">${html}</div>`);
    }
    return parts;
  }
  return String(c.text || "")
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<div style="${wrapperStyle}white-space:pre-wrap;">${substituteTokens(p, valuesByName, fieldsByName)}</div>`);
}

function isFileValue(value: CustomFormResponseValue | undefined): value is { url: string; fileName?: string } {
  return !!value && typeof value === "object" && !Array.isArray(value) && "url" in (value as any);
}

/**
 * Fetches a remote image (a Firebase Storage download URL — the Logo block,
 * or a signature/file answer) and inlines it as a data: URL. html2canvas
 * captures a same-document data: URL instantly and unconditionally, whereas
 * a live remote `<img src>` depends on that request actually completing
 * (and succeeding) before the capture runs — one flaky network hiccup and
 * the image just silently doesn't show up in the generated PDF.
 *
 * Fetches through this app's own /api/image-proxy (src/lib/server/imageProxyBridge.ts)
 * rather than straight from Firebase Storage: a browser `fetch()` straight
 * to firebasestorage.googleapis.com is a cross-origin request, which the
 * browser silently blocks unless the bucket itself has CORS configured
 * (most Firebase projects don't, by default) — the proxy fetches
 * server-to-server instead, where CORS doesn't apply at all, then hands the
 * bytes back same-origin. Falls back to the original URL (today's
 * behavior) if the proxy call fails for any reason, so this can only make
 * image rendering more reliable, never less.
 */
async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`Image proxy responded ${res.status}`);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

/** Every image URL a template actually references — Image/Logo blocks' imageUrl, plus any fieldValue block answering with a signature/file upload. */
function collectImageUrls(blocks: DocumentBlock[], valuesByName: Record<string, CustomFormResponseValue>): string[] {
  const urls = new Set<string>();
  for (const b of blocks) {
    if (b.type === "image" && b.imageUrl) urls.add(b.imageUrl);
    if (b.type === "fieldValue" && b.fieldName) {
      const value = valuesByName[b.fieldName];
      if (isFileValue(value)) urls.add(value.url);
    }
  }
  return Array.from(urls);
}

function substituteTokens(text: string, valuesByName: Record<string, CustomFormResponseValue>, fieldsByName: Record<string, CustomFormField>): string {
  return escapeHtml(text).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name) => escapeHtml(formatFieldValue(valuesByName[name], fieldsByName[name])));
}

/**
 * Turns a block's width/displayMode/style (the same FieldStyle shape a
 * form field's Style tab edits — see src/lib/formElements/types.ts) into a
 * CSS string for the block's wrapper `<div>`. Deliberately NOT reusing
 * applyFieldStyle's flexBasis-based width here: that only works inside a
 * flex parent, which the React canvas/renderer provide but this raw HTML
 * (rasterized by html2canvas, which handles simple inline-block/float
 * layouts more reliably than flexbox) does not — inline-block + width
 * achieves the same side-by-side wrapping without needing one. Text
 * properties (color/font-size/weight/alignment) are set here on the
 * wrapper and inherited by the plain inner markup below rather than
 * repeated per block type.
 */
function blockWrapperStyle(block: DocumentBlock): string {
  const s = block.style ?? {};
  const parts: string[] = [];
  if (block.displayMode === "block") parts.push(`display:block`, `width:${block.width}%`, `box-sizing:border-box`);
  else if (block.displayMode === "shrink") parts.push(`display:inline-block`, `width:auto`);
  else parts.push(`display:inline-block`);
  parts.push(`margin:${s.margin || "0 0 12px 0"}`);
  if (s.padding) parts.push(`padding:${s.padding}`);
  if (s.alignment) parts.push(`text-align:${s.alignment}`);
  if (s.borderRadius != null) parts.push(`border-radius:${s.borderRadius}px`);
  if (s.backgroundColor) parts.push(`background-color:${s.backgroundColor}`);
  if (s.borderColor) parts.push(`border:1px solid ${s.borderColor}`);
  if (s.textColor) parts.push(`color:${s.textColor}`);
  parts.push(`font-size:${s.fontSize ?? 12}px`);
  if (s.fontWeight) parts.push(`font-weight:${s.fontWeight}`);
  if (s.shadow) parts.push(`box-shadow:0 2px 8px rgba(0,0,0,0.15)`);
  if (s.opacity != null) parts.push(`opacity:${s.opacity}`);
  return parts.join(";");
}

function renderBlockContent(block: DocumentBlock, valuesByName: Record<string, CustomFormResponseValue>, fieldsByName: Record<string, CustomFormField>, submittedAt: string): string {
  switch (block.type) {
    case "heading":
      return `<div style="margin:0;">${substituteTokens(block.text ?? "", valuesByName, fieldsByName)}</div>`;
    case "paragraph":
      return `<div style="margin:0;white-space:pre-wrap;">${substituteTokens(block.text ?? "", valuesByName, fieldsByName)}</div>`;
    case "image":
      return block.imageUrl ? `<img src="${block.imageUrl}" style="max-width:100%;display:block;" />` : "";
    case "divider":
      return `<hr style="border-top:1px solid #e2e8f0;margin:0;" />`;
    case "spacer":
      return `<div style="height:24px;"></div>`;
    case "date":
      return `<div style="margin:0;">${escapeHtml(formatDocumentDate(new Date(submittedAt)))}</div>`;
    case "fieldValue": {
      const fieldName = block.fieldName ?? "";
      const value = valuesByName[fieldName];
      const field = fieldsByName[fieldName];
      // Stale reference (the field was renamed or deleted) — leave it out
      // instead of printing a bare "name:" label with nothing after it.
      if (!field) return "";
      if (DISPLAY_TYPES.has(field.type)) return renderDisplayFieldHtml(field, valuesByName, fieldsByName).join("");
      const label = field.label || fieldName;
      const prefix = block.showLabel !== false && label ? `<strong>${escapeHtml(label)}:</strong> ` : "";
      if (isFileValue(value)) return `<div style="margin:0;">${prefix}<img src="${value.url}" style="max-width:300px;display:block;margin-top:4px;" /></div>`;
      return `<div style="margin:0;">${prefix}${escapeHtml(formatFieldValue(value, field))}</div>`;
    }
    default:
      return "";
  }
}

/** camelCase React style keys → kebab-case CSS, skipping unset properties — turns pinnedBlockStyle's CSSProperties object into a plain inline-style string for the raw HTML captured into a PDF. */
function styleObjectToCss(style: CSSProperties): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}:${v}`)
    .join(";");
}

function renderBlock(block: DocumentBlock, valuesByName: Record<string, CustomFormResponseValue>, fieldsByName: Record<string, CustomFormField>, submittedAt: string): string {
  const content = renderBlockContent(block, valuesByName, fieldsByName, submittedAt);
  if (!content) return "";
  if (block.position) {
    return `<div class="pinned-block" style="${styleObjectToCss(pinnedBlockStyle(block))}">${content}</div>`;
  }
  return `<div style="${blockWrapperStyle(block)}">${content}</div>`;
}

/**
 * Pinned blocks (Logo/Date) are free-floating overlays at the top of the
 * page, which can visually overlap the ordinary flowing content if nothing
 * accounts for them — this pushes the whole flow block down below the
 * lowest pinned block's actual rendered bottom edge, measured against the
 * real (already-loaded, so image dimensions are final) DOM right before
 * capture, exactly the way the builder itself does it live.
 */
function reflowFlowContentBelowPinnedBlocks(doc: Document): void {
  const pinnedEls = Array.from(doc.querySelectorAll<HTMLElement>(".pinned-block"));
  const flowEl = doc.querySelector<HTMLElement>(".doc-flow");
  if (!flowEl || pinnedEls.length === 0) return;
  const maxBottom = pinnedEls.reduce((max, el) => Math.max(max, el.offsetTop + el.offsetHeight), 0);
  if (maxBottom > 0) flowEl.style.paddingTop = `${maxBottom}px`;
}

export async function renderDocumentTemplateHtml(template: DocumentTemplate, form: Pick<CustomForm, "fields">, submission: Pick<CustomFormSubmission, "responses" | "submittedAt">): Promise<{ html: string; styles: string }> {
  const valuesByName: Record<string, CustomFormResponseValue> = {};
  const fieldsByName: Record<string, CustomFormField> = {};
  for (const f of form.fields) {
    valuesByName[f.name] = submission.responses[f.id] ?? null;
    fieldsByName[f.name] = f;
  }

  const normalizedBlocks = template.blocks.map(normalizeDocumentBlock);
  const imageUrls = collectImageUrls(normalizedBlocks, valuesByName);
  const dataUrlByUrl = new Map<string, string>(await Promise.all(imageUrls.map(async (url) => [url, await toDataUrl(url)] as const)));
  const resolvedBlocks = normalizedBlocks.map((b) => (b.type === "image" && b.imageUrl ? { ...b, imageUrl: dataUrlByUrl.get(b.imageUrl) ?? b.imageUrl } : b));
  for (const [name, value] of Object.entries(valuesByName)) {
    if (isFileValue(value)) valuesByName[name] = { ...value, url: dataUrlByUrl.get(value.url) ?? value.url };
  }

  const flowHtml = resolvedBlocks.filter((b) => !b.position).map((b) => renderBlock(b, valuesByName, fieldsByName, submission.submittedAt)).join("\n");
  const pinnedHtml = resolvedBlocks.filter((b) => !!b.position).map((b) => renderBlock(b, valuesByName, fieldsByName, submission.submittedAt)).join("\n");
  const styles = `.doc-page { position: relative; width: ${PAGE_WIDTH}px; min-height: ${PAGE_HEIGHT}px; background: #fff; padding: ${PAGE_PADDING}px; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 12px; line-height: 1.5; }`;
  return { html: `<div class="doc-page"><div class="doc-flow">${flowHtml}</div>${pinnedHtml}</div>`, styles };
}

export async function generateSubmissionPdf(template: DocumentTemplate, form: Pick<CustomForm, "fields">, submission: Pick<CustomFormSubmission, "responses" | "submittedAt">): Promise<Blob> {
  const { html, styles } = await renderDocumentTemplateHtml(template, form, submission);
  return captureHtmlToPdfBlob(html, styles, { beforeCapture: reflowFlowContentBelowPinnedBlocks });
}

// ---------- Automatic document (no Document Template designed) ----------

/** Never part of the document: page/section markers, the submit button, and anti-bot checks. */
const SKIPPED_IN_DOCUMENT = new Set(["pageBreak", "sectionCollapse", "submitButton", "captcha"]);
const FOOTER_SPACE = 30;

const AUTO_DOC_STYLES = `
.doc-page { position: relative; width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; overflow: hidden; background: #fff; padding: ${PAGE_PADDING}px; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #111827; line-height: 1.5; }
.doc-flow { width: ${PAGE_CONTENT_WIDTH}px; font-size: 0; }
.doc-blk { display: inline-block; vertical-align: bottom; box-sizing: border-box; font-size: 12px; padding-right: 18px; margin-bottom: 10px; }
.doc-blk.full { padding-right: 0; }
.doc-rich p { margin: 0; }
.doc-rich ul, .doc-rich ol { margin: 0; padding-left: 22px; }
.doc-ans-value { min-height: 18px; padding: 0 2px; white-space: pre-wrap; }
.doc-sig-img { height: 54px; position: relative; }
.doc-sig-img img { position: absolute; left: 0; bottom: 0; max-height: 54px; max-width: 100%; }
.doc-line { border-top: 1px solid #111827; margin-top: 2px; }
.doc-under { font-size: 11px; color: #374151; margin-top: 3px; }
.doc-footer { position: absolute; left: 0; right: 0; bottom: 34px; text-align: center; font-size: 10px; color: #6b7280; }
`;

/**
 * One answer as document HTML, the way a signed paper form reads: the
 * answer (or signature) sits on a line with its label underneath. Blocks
 * are bottom-aligned, so a Date beside a Signature shares its line.
 */
function renderAnswerHtml(field: CustomFormField, value: CustomFormResponseValue | undefined): string {
  const label = escapeHtml(field.label || field.name);
  if (ELEMENT_REGISTRY[field.type]?.isFileField) {
    const img = isFileValue(value) ? `<img src="${value.url}" />` : "";
    return `<div class="doc-sig-img">${img}</div><div class="doc-line"></div><div class="doc-under">${label}</div>`;
  }
  const text = formatFieldValue(value, field);
  return `<div class="doc-ans-value">${text ? escapeHtml(text) : "&nbsp;"}</div><div class="doc-line"></div><div class="doc-under">${label}</div>`;
}

/** The form itself laid out as a document, in field order: its own headings and paragraphs as written, every answer, signatures on signing lines. */
function buildAutoDocumentBlocks(form: Pick<CustomForm, "title" | "fields">, valuesByName: Record<string, CustomFormResponseValue>, fieldsByName: Record<string, CustomFormField>): string[] {
  const blocks: string[] = [];
  const fields = form.fields.filter((f) => !f.hidden && !SKIPPED_IN_DOCUMENT.has(f.type));
  if (!fields.some((f) => f.type === "heading")) {
    blocks.push(`<div class="doc-blk full" style="width:100%;font-size:16px;font-weight:700;text-align:center;">${escapeHtml(form.title)}</div>`);
  }
  for (const field of fields) {
    if (DISPLAY_TYPES.has(field.type)) {
      for (const html of renderDisplayFieldHtml(field, valuesByName, fieldsByName)) blocks.push(`<div class="doc-blk full" style="width:100%;">${html}</div>`);
      continue;
    }
    const width = field.width ?? 100;
    blocks.push(`<div class="doc-blk${width >= 100 ? " full" : ""}" style="width:${width}%;">${renderAnswerHtml(field, valuesByName[field.name])}</div>`);
  }
  return blocks;
}

/**
 * Splits blocks across Letter pages: lays them all out once in a hidden
 * iframe at the real content width, groups blocks sharing a line (side-by-
 * side fields) into rows, then fills each page with whole rows.
 */
async function paginateBlocks(blocks: string[]): Promise<string[][]> {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-99999px";
  iframe.style.top = "0";
  iframe.style.width = `${PAGE_WIDTH}px`;
  iframe.style.height = `${PAGE_HEIGHT}px`;
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = `<!DOCTYPE html><html><head><style>body{margin:0;}${AUTO_DOC_STYLES}</style></head><body><div class="doc-flow">${blocks.join("")}</div></body></html>`;
    });
    const els = Array.from(iframe.contentDocument?.querySelectorAll<HTMLElement>(".doc-flow > .doc-blk") ?? []);
    if (els.length !== blocks.length) return [blocks];
    const rows: { top: number; bottom: number; items: string[] }[] = [];
    els.forEach((el, i) => {
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight + 10; // + .doc-blk margin-bottom
      const row = rows[rows.length - 1];
      // Bottom-aligned, so blocks on one line can start at different heights —
      // same row = starts before the current row's blocks end.
      if (row && top < row.bottom - 10) {
        row.items.push(blocks[i]);
        row.top = Math.min(row.top, top);
        row.bottom = Math.max(row.bottom, bottom);
      } else {
        rows.push({ top, bottom, items: [blocks[i]] });
      }
    });
    const capacity = PAGE_HEIGHT - PAGE_PADDING * 2 - FOOTER_SPACE;
    const pages: string[][] = [[]];
    let used = 0;
    for (const row of rows) {
      const h = row.bottom - row.top;
      if (used > 0 && used + h > capacity) {
        pages.push([]);
        used = 0;
      }
      pages[pages.length - 1].push(...row.items);
      used += h;
    }
    return pages;
  } finally {
    document.body.removeChild(iframe);
  }
}

export async function generateAutoDocumentPdf(form: Pick<CustomForm, "title" | "fields">, submission: Pick<CustomFormSubmission, "responses">): Promise<Blob> {
  const valuesByName: Record<string, CustomFormResponseValue> = {};
  const fieldsByName: Record<string, CustomFormField> = {};
  for (const f of form.fields) {
    valuesByName[f.name] = submission.responses[f.id] ?? null;
    fieldsByName[f.name] = f;
  }
  // Signatures/uploads inlined as data: URLs — see toDataUrl.
  for (const [name, value] of Object.entries(valuesByName)) {
    if (isFileValue(value)) valuesByName[name] = { ...value, url: await toDataUrl(value.url) };
  }
  const pages = await paginateBlocks(buildAutoDocumentBlocks(form, valuesByName, fieldsByName));
  const pageHtml = pages.map(
    (items, i) => `<div class="doc-page"><div class="doc-flow">${items.join("")}</div>${pages.length > 1 ? `<div class="doc-footer">Page ${i + 1} of ${pages.length}</div>` : ""}</div>`
  );
  return captureHtmlPagesToPdfBlob(pageHtml, AUTO_DOC_STYLES);
}

/** The submission's document: the form's own Document Template when one is designed, otherwise the automatic layout above — so every form can produce a PDF. */
export async function generateSubmissionDocumentPdf(
  form: Pick<CustomForm, "title" | "fields" | "documentTemplate">,
  submission: Pick<CustomFormSubmission, "responses" | "submittedAt">
): Promise<Blob> {
  return form.documentTemplate ? generateSubmissionPdf(form.documentTemplate, form, submission) : generateAutoDocumentPdf(form, submission);
}
