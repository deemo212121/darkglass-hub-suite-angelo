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
import { captureHtmlPagesToPdfBlob, captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
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

export const DISPLAY_TYPES = new Set(["heading", "paragraph", "divider"]);
export const HEADING_SIZES: Record<number, number> = { 1: 24, 2: 20, 3: 16, 4: 14, 5: 13, 6: 12 };

/** The company letterhead logo on automatic documents (PDF and Word) — the same US In Home Services seal the other HR forms use. */
export function loadDocumentLogo(): Promise<string> {
  return loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png"));
}

/** A Paragraph element's rich text with {{field_name}} tokens filled from the answers, sanitized. */
export function fillDisplayHtml(html: string, valuesByName: Record<string, CustomFormResponseValue>, fieldsByName: Record<string, CustomFormField>): string {
  const filled = String(html).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_: string, name: string) => escapeHtml(formatFieldValue(valuesByName[name], fieldsByName[name])));
  return DOMPurify.sanitize(filled);
}

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
    const holder = document.createElement("div");
    holder.innerHTML = fillDisplayHtml(c.html, valuesByName, fieldsByName);
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
export async function toDataUrl(url: string): Promise<string> {
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

/** Bytes of a Firebase Storage file (or data: URL) — through /api/image-proxy, since the bucket sends no CORS headers (see toDataUrl). */
async function fetchStorageBytes(url: string): Promise<Uint8Array> {
  const res = url.startsWith("data:") ? await fetch(url) : await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Couldn't load ${url.startsWith("data:") ? "the image" : "the document"} (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** "MM/DD", "MM/DD/YYYY", "YYYY-MM-DD"… from a stored YYYY-MM-DD date. */
function formatStampDate(value: string, format: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? format.replace("YYYY", m[1]).replace("MM", m[2]).replace("DD", m[3]) : value;
}

/**
 * The document is an existing PDF (DocumentTemplate.sourcePdf — e.g. the
 * scanned agreement the other party already signed on paper) with this
 * submission's answers stamped on: a signature fitted into its box, bottom
 * left, so it sits on the signature line; anything else as text. pdf-lib
 * draws from the bottom-left, so the stamps' top-left boxes are flipped.
 */
export async function generateStampedSourcePdf(sourcePdf: NonNullable<DocumentTemplate["sourcePdf"]>, form: Pick<CustomForm, "fields">, submission: Pick<CustomFormSubmission, "responses">): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.load(await fetchStorageBytes(sourcePdf.url));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.06, 0.09, 0.16);
  for (const stamp of sourcePdf.stamps) {
    const field = form.fields.find((f) => f.name === stamp.fieldName);
    const value = field ? submission.responses[field.id] : undefined;
    if (!field || value == null || value === "") continue;
    const page = doc.getPage(stamp.page - 1);
    const bottom = page.getHeight() - stamp.y - stamp.height;
    if (typeof value === "object" && !Array.isArray(value) && "url" in value) {
      const bytes = await fetchStorageBytes((value as { url: string }).url);
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const scale = Math.min(stamp.width / image.width, stamp.height / image.height);
      page.drawImage(image, { x: stamp.x, y: bottom, width: image.width * scale, height: image.height * scale });
    } else {
      const text = field.type === "datePicker" && typeof value === "string" ? formatStampDate(value, stamp.dateFormat ?? "MM/DD/YYYY") : formatFieldValue(value, field);
      let size = stamp.fontSize ?? 11;
      while (size > 6 && font.widthOfTextAtSize(text, size) > stamp.width) size -= 0.5;
      page.drawText(text, { x: stamp.x, y: bottom + (stamp.height - size) / 2 + 1, size, font, color: ink });
    }
  }
  return new Blob([(await doc.save()) as BlobPart], { type: "application/pdf" });
}

export async function generateSubmissionPdf(template: DocumentTemplate, form: Pick<CustomForm, "fields">, submission: Pick<CustomFormSubmission, "responses" | "submittedAt">): Promise<Blob> {
  if (template.sourcePdf) return generateStampedSourcePdf(template.sourcePdf, form, submission);
  const { html, styles } = await renderDocumentTemplateHtml(template, form, submission);
  return captureHtmlToPdfBlob(html, styles, { beforeCapture: reflowFlowContentBelowPinnedBlocks });
}

// ---------- Automatic document (no Document Template designed) ----------

/** Never part of the document: page/section markers, the submit button, and anti-bot checks. */
export const SKIPPED_IN_DOCUMENT = new Set(["pageBreak", "sectionCollapse", "submitButton", "captcha"]);
const FOOTER_SPACE = 30;
/** Top/bottom page margin for automatic documents (0.625in) — left/right stay PAGE_PADDING so the content width is unchanged. */
const AUTO_PAD_Y = 60;

const AUTO_DOC_STYLES = `
.doc-page { position: relative; width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; overflow: hidden; background: #fff; padding: ${AUTO_PAD_Y}px ${PAGE_PADDING}px; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #111827; line-height: 1.5; }
.doc-flow { width: ${PAGE_CONTENT_WIDTH}px; font-size: 0; }
.doc-blk { display: inline-block; vertical-align: bottom; box-sizing: border-box; font-size: 12px; padding-right: 18px; margin-bottom: 10px; }
.doc-blk.full { padding-right: 0; }
.doc-blk.text { margin-bottom: 2px; }
.doc-rich p { margin: 0; }
.doc-rich ul, .doc-rich ol { margin: 0; padding-left: 22px; }
.doc-ans-value { min-height: 18px; padding: 0 2px 6px; white-space: pre-wrap; } /* html2canvas draws text a few px lower than the browser — keep it clear of the line */
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
function buildAutoDocumentBlocks(form: Pick<CustomForm, "title" | "fields">, valuesByName: Record<string, CustomFormResponseValue>, fieldsByName: Record<string, CustomFormField>, logoDataUrl: string): string[] {
  const blocks: string[] = [];
  if (logoDataUrl) blocks.push(`<div class="doc-blk full text" style="width:100%;text-align:center;"><img src="${logoDataUrl}" style="width:100px;height:100px;" /></div>`);
  const fields = form.fields.filter((f) => !f.hidden && !SKIPPED_IN_DOCUMENT.has(f.type));
  if (!fields.some((f) => f.type === "heading")) {
    blocks.push(`<div class="doc-blk full" style="width:100%;font-size:16px;font-weight:700;text-align:center;">${escapeHtml(form.title)}</div>`);
  }
  for (const field of fields) {
    if (DISPLAY_TYPES.has(field.type)) {
      for (const html of renderDisplayFieldHtml(field, valuesByName, fieldsByName)) {
        // Headings, and a paragraph that's only a bold title (e.g. "2.1 …"), stay on the page with what follows — see paginateBlocks.
        const keep = field.type === "heading" || /^<div class="doc-rich"[^>]*><p><strong>[^<]*<\/strong><\/p><\/div>$/.test(html);
        blocks.push(`<div class="doc-blk full text${keep ? " doc-keep" : ""}" style="width:100%;">${html}</div>`);
      }
      continue;
    }
    const width = field.width ?? 100;
    blocks.push(`<div class="doc-blk${width >= 100 ? " full" : ""}" style="width:${width}%;">${renderAnswerHtml(field, valuesByName[field.name])}</div>`);
  }
  return blocks;
}

/**
 * Splits blocks across Letter pages: lays them all out once in a hidden
 * iframe at the real content width (inside a .doc-page, so the font and line
 * height match the captured page), groups blocks sharing a line (side-by-
 * side fields) into rows, then fills each page with whole rows. A heading
 * (or bold title paragraph) is never left at the foot of a page: it moves
 * with the answer rows under it — a whole signing block (Signature/Date,
 * Name/Title) — or with the next row.
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
      iframe.srcdoc = `<!DOCTYPE html><html><head><style>body{margin:0;}${AUTO_DOC_STYLES}</style></head><body><div class="doc-page" style="height:auto;padding:0;"><div class="doc-flow">${blocks.join("")}</div></div></body></html>`;
    });
    const els = Array.from(iframe.contentDocument?.querySelectorAll<HTMLElement>(".doc-flow > .doc-blk") ?? []);
    if (els.length !== blocks.length) return [blocks];
    const win = iframe.contentWindow!;
    // contentBottom = the blocks' own bottom edge; margin = the gap after them.
    // keep = a heading/title that stays with what follows; answer = a field's answer (not text).
    const rows: { top: number; contentBottom: number; margin: number; items: string[]; keep: boolean; answer: boolean }[] = [];
    els.forEach((el, i) => {
      const top = el.offsetTop;
      const contentBottom = top + el.offsetHeight;
      const margin = parseFloat(win.getComputedStyle(el).marginBottom) || 0;
      const keep = el.classList.contains("doc-keep");
      const answer = !el.classList.contains("text");
      const row = rows[rows.length - 1];
      // Bottom-aligned, so blocks on one line can start at different heights —
      // same row = starts before the current row's blocks end.
      if (row && top < row.contentBottom) {
        row.items.push(blocks[i]);
        row.top = Math.min(row.top, top);
        row.contentBottom = Math.max(row.contentBottom, contentBottom);
        row.margin = Math.max(row.margin, margin);
        row.keep ||= keep;
        row.answer &&= answer;
      } else {
        rows.push({ top, contentBottom, margin, items: [blocks[i]], keep, answer });
      }
    });
    // A one-page document has no "Page 1 of 1" footer, so it may use that space too.
    const fullPage = PAGE_HEIGHT - AUTO_PAD_Y * 2;
    const total = rows.reduce((sum, r) => sum + r.contentBottom - r.top + r.margin, 0) - (rows[rows.length - 1]?.margin ?? 0);
    if (total <= fullPage) return [rows.flatMap((r) => r.items)];
    const capacity = fullPage - FOOTER_SPACE;
    const height = (r: (typeof rows)[number]) => r.contentBottom - r.top + r.margin;
    const pages: string[][] = [[]];
    let used = 0;
    rows.forEach((row, i) => {
      const h = height(row);
      // What has to land on the same page as this row: a heading takes the
      // answer rows under it (a signing block), or else the next row.
      let last = i;
      if (row.keep && i + 1 < rows.length) {
        last = i + 1;
        if (rows[last].answer) while (last + 1 < rows.length && rows[last + 1].answer) last++;
      }
      let need = rows.slice(i, last + 1).reduce((sum, r) => sum + height(r), 0) - rows[last].margin;
      if (need > capacity) need = h - row.margin; // too big to keep together — place it row by row
      // A row's trailing gap doesn't need to fit — it's just space before the next row.
      if (used > 0 && used + need > capacity) {
        pages.push([]);
        used = 0;
      }
      pages[pages.length - 1].push(...row.items);
      used += h;
    });
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
  const pages = await paginateBlocks(buildAutoDocumentBlocks(form, valuesByName, fieldsByName, await loadDocumentLogo()));
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
