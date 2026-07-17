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
  opts?: { width?: number; height?: number }
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
    const imgData = canvas.toDataURL("image/png");
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
    pdf.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);
    return pdf.output("blob");
  } finally {
    document.body.removeChild(iframe);
  }
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
