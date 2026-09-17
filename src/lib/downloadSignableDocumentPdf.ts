/**
 * Forces a real browser download (save-to-disk) of a signable-document PDF
 * from Firebase Storage, under a friendly filename — every "Download PDF"
 * button in ReportHRDaily.tsx uses this.
 *
 * fetch()-ing the file into a blob and driving an `<a download>` click off
 * that blob: URL is the only technique that reliably forces a real
 * download rather than just navigating to/opening the file (a plain
 * `<a href=... download>` pointed straight at the Firebase Storage URL is
 * NOT enough — cross-origin `download` attributes are unreliable across
 * browsers, and Storage doesn't always serve Content-Disposition:
 * attachment). This never opens a new tab on the success path.
 *
 * Fetches through this app's own /api/image-proxy
 * (src/lib/server/imageProxyBridge.ts) rather than a direct browser
 * fetch() straight to Firebase Storage — a direct fetch() is a
 * cross-origin request the browser silently blocks unless the bucket
 * itself has CORS configured for the exact origin the app is being viewed
 * from (confirmed NOT configured for a LAN dev-server origin — every
 * "Download PDF" click there was silently falling straight to the
 * tab-opening fallback below). The proxy fetches server-to-server, where
 * browser CORS doesn't apply at all, so the real download works
 * regardless of which origin the app is viewed from.
 *
 * The only case this can't force a download now is the proxy request
 * itself failing (its own network hiccup, or the server being
 * unreachable) — rare enough to treat as a true last-resort fallback:
 * open the file directly so the user can at least view/save it manually,
 * and tell them if even that gets popup-blocked (browsers only allow
 * window.open() to bypass popup blocking when it's still considered part
 * of the original click — by the time an awaited fetch has failed, a
 * strict browser like Safari may no longer count it as one, so silently
 * doing nothing here was a real, previously-reported bug).
 */
export async function downloadSignableDocumentPdf(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      alert("Couldn't open the file automatically — your browser may have blocked the pop-up. Please allow pop-ups for this site and try again.");
    }
  }
}
