/**
 * pdfjs-dist 6.x calls Promise.try internally (both its main bundle and its
 * worker bundle) — a JS feature only shipped in browsers from late 2024+
 * (Chrome 128, Firefox 132, Safari 18.4). On anything older it throws
 * "Promise.try is not a function", the worker setup silently falls back to
 * "fake worker" mode, and the same missing method then throws again on the
 * main thread — leaving every real-PDF fill/sign page (mileage & fuel
 * policy, wage ack, I-9, etc. — anything using pdfjs-dist) stuck on
 * "Loading form…" forever. Importing this file for its side effect, before
 * any pdfjs-dist import can run, patches the method in so those browsers
 * work like anything newer.
 */
if (typeof (Promise as any).try !== "function") {
  (Promise as any).try = function <T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}
