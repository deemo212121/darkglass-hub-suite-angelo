/**
 * Renders arbitrary HTML (body markup + styles) into an isolated, blank
 * iframe — no host app stylesheet loaded at all — then rasterizes it via
 * html2canvas and wraps the result in a PDF via jsPDF. Isolation matters
 * because html2canvas can't parse oklch() colors at all, and this app's
 * entire design system defines every color that way (see src/styles.css)
 * — capturing anything inside the app's live DOM would inherit those
 * globally through Tailwind's preflight `*` rule (border-color: var(--border)
 * applies to literally every element). Returns a ready-to-upload PDF Blob.
 */
export async function captureHtmlToPdfBlob(
  bodyHtml: string,
  styles: string,
  opts?: { width?: number; height?: number; beforeCapture?: (doc: Document) => void }
): Promise<Blob> {
  const width = opts?.width ?? 816;
  // Matches the US Letter 8.5x11in @ 96dpi target every template (COE,
  // Warning Form) is actually built for (both containers declare
  // min-height: 1056px) — capturing at a taller default like 1400 just adds
  // that much dead white space below the real content on every export.
  const height = opts?.height ?? 1056;
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-99999px";
  iframe.style.top = "0";
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = `<!DOCTYPE html><html><head><style>body{margin:0;}${styles}</style></head><body>${bodyHtml}</body></html>`;
    });
    const body = iframe.contentDocument?.body;
    if (!body) throw new Error("Could not prepare document for capture.");
    // Runs against the real (already-loaded) iframe document just before
    // rasterizing — lets a caller measure actual rendered layout (e.g. a
    // pinned logo's real height, only known once its image has loaded) and
    // adjust the DOM in response, so html2canvas captures the adjusted
    // result rather than the pre-adjustment layout.
    opts?.beforeCapture?.(iframe.contentDocument!);
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    // useCORS: true — a signature image (uploaded to Firebase Storage,
    // a real cross-origin URL, unlike the logo which is embedded as a
    // local data: URL) is otherwise silently skipped by html2canvas
    // instead of erroring, leaving a blank gap with no visible sign of
    // what went wrong.
    // scale: 2 renders the canvas at double pixel density for crisper text —
    // but the PDF *page* must stay sized to the intended width/height (not
    // canvas.width/canvas.height, which are 2x that). Using the raw canvas
    // pixel size as the page format was making every exported PDF a
    // physically oversized page (double width AND height = ~4x the area),
    // which is why it opened looking huge until zoomed way out. The
    // high-resolution image still gets placed at full page size below —
    // it's just scaled down to fit instead of inflating the page around it.
    const canvas = await html2canvas(body, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    // JPEG, not PNG — jsPDF re-embeds a PNG's raw RGBA pixels uncompressed
    // instead of keeping the PNG's own DEFLATE stream, so a ~400KB PNG
    // snapshot was inflating to a ~13MB PDF page. JPEG is already compressed
    // before it reaches jsPDF and passes through untouched. Every page here
    // is opaque white (backgroundColor above), so JPEG's lack of an alpha
    // channel costs nothing, and 0.92 quality is visually lossless for flat
    // text/lines — measured ~15x smaller with no visible difference.
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    // jsPDF's "px" unit does NOT mean CSS px @ 96dpi — it takes the format
    // numbers as raw PDF points (1/72in) verbatim. So a [816, 1056] "px" page
    // actually became an 816x1056-POINT page (11.3 x 14.7in), ~1.33x oversized
    // in each direction versus a real, Google/Word-style US Letter page
    // (612x792pt = 8.5x11in). Converting our CSS-px template dimensions to
    // points (1px @ 96dpi = 0.75pt) and building the PDF in "pt" units gives
    // an actual standard Letter page for the common case. Height is still
    // derived from the canvas's own aspect ratio (not hardcoded) so content
    // that overflows the 1056px design height gets a taller page instead of
    // being squished to fit.
    const PX_TO_PT = 0.75;
    const pageWidth = width * PX_TO_PT;
    const pageHeight = (canvas.height / canvas.width) * pageWidth;
    const pdf = new jsPDF({ unit: "pt", format: [pageWidth, pageHeight] });
    pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight);
    return pdf.output("blob");
  } finally {
    document.body.removeChild(iframe);
  }
}

/**
 * Same rendering pipeline as captureHtmlToPdfBlob, but for a document made
 * of several separate pages (e.g. a 4-page agreement) instead of one tall
 * scrolling page — each entry in `bodyHtmlPages` becomes its own real PDF
 * page (`pdf.addPage()`), not one overlong page. Used by
 * ndaFormTemplate.ts's multi-page Non-Disclosure Agreement; every
 * single-page form keeps using captureHtmlToPdfBlob unchanged.
 */
export async function captureHtmlPagesToPdfBlob(
  bodyHtmlPages: string[],
  styles: string,
  opts?: { width?: number; height?: number }
): Promise<Blob> {
  const width = opts?.width ?? 816;
  const height = opts?.height ?? 1056;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const PX_TO_PT = 0.75;
  const pageWidthPt = width * PX_TO_PT;
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const bodyHtml of bodyHtmlPages) {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-99999px";
    iframe.style.top = "0";
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    document.body.appendChild(iframe);
    try {
      await new Promise<void>((resolve) => {
        iframe.onload = () => resolve();
        iframe.srcdoc = `<!DOCTYPE html><html><head><style>body{margin:0;}${styles}</style></head><body>${bodyHtml}</body></html>`;
      });
      const body = iframe.contentDocument?.body;
      if (!body) throw new Error("Could not prepare document for capture.");
      const canvas = await html2canvas(body, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      // JPEG, not PNG — see captureHtmlToPdfBlob's comment above. This
      // matters even more here: a 4-page PNG-based NDA PDF measured ~51MB
      // (over the Storage rules' 25MB cap, causing storage/unauthorized on
      // upload), JPEG brought the same 4 pages to well under 1MB.
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const pageHeightPt = (canvas.height / canvas.width) * pageWidthPt;
      if (!pdf) {
        pdf = new jsPDF({ unit: "pt", format: [pageWidthPt, pageHeightPt] });
      } else {
        pdf.addPage([pageWidthPt, pageHeightPt]);
      }
      pdf.addImage(imgData, "JPEG", 0, 0, pageWidthPt, pageHeightPt);
    } finally {
      document.body.removeChild(iframe);
    }
  }
  if (!pdf) throw new Error("No pages to render.");
  return pdf.output("blob");
}

/** Raw base64 (no "data:...;base64," prefix) — for handing a captured PDF to a JSON API that attaches/uploads it server-side (e.g. gmailBridge.ts's send-payslip). */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

/** Loads a bundled asset (imported via `@/assets/...`) as a data URL, so a print/capture document never depends on a live network fetch. Returns "" (graceful no-image) if the asset is missing. */
export async function loadAssetDataUrl(importFn: () => Promise<{ default: string }>): Promise<string> {
  try {
    const mod = await importFn();
    const res = await fetch(mod.default);
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}
