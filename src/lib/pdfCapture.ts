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
  const height = opts?.height ?? 1400;
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
    const canvas = await html2canvas(body, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
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
