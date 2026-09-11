/**
 * Downloads/opens a signable-document PDF from Firebase Storage with a
 * friendly filename, working around two real failure modes every
 * "Download PDF" button in ReportHRDaily.tsx used to hit:
 *
 * 1. fetch()-ing the file to rename it via a blob needs Storage's CORS
 *    config to include the exact origin the app is being viewed from —
 *    an origin not explicitly allow-listed (confirmed live 2026-09 for a
 *    LAN dev-server origin, fetching real substance-screening PDFs) throws
 *    a CORS error instead of a response.
 * 2. The old fallback called window.open() from inside an async catch
 *    block, AFTER an awaited fetch had already failed — by then the
 *    click's original synchronous "user gesture" window has closed in
 *    most browsers, so that window.open() is itself silently popup-
 *    blocked. Net effect: the download does nothing at all, with no
 *    visible error to the user — this is what "some files aren't showing"
 *    turned out to be.
 *
 * Opening a blank tab SYNCHRONOUSLY, before any await, sidesteps #2 (that
 * window.open is still inside the click's gesture and is never blocked),
 * then redirecting that already-open tab to either the renamed blob (if
 * the fetch succeeds) or the original URL (if it doesn't) sidesteps #1 by
 * degrading to "just open the file" instead of downloading nothing.
 */
export async function downloadSignableDocumentPdf(url: string, filename: string): Promise<void> {
  const win = window.open("", "_blank", "noopener,noreferrer");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    if (win) {
      win.location.href = blobUrl;
    } else {
      // Popup blocked even for the synchronous open (rare) — fall back to
      // a same-page forced download, which still works since the fetch
      // itself succeeded here.
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(blobUrl);
    }
  } catch {
    if (win) win.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  }
}
