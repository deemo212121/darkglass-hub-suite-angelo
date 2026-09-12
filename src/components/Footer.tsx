// Baked in at build time by vite.config.ts's APP_DEFINE — always reflects
// exactly what was built/deployed, no runtime lookup needed.
const APP_VERSION = typeof (globalThis as any).__APP_VERSION__ === "string" ? (globalThis as any).__APP_VERSION__ : "0.0.0";
const GIT_SHA = typeof (globalThis as any).__GIT_SHA__ === "string" ? (globalThis as any).__GIT_SHA__ : "unknown";

export function Footer() {
  return (
    <footer id="contact" className="border-t border-white/10 mt-16">
      <div className="max-w-7xl mx-auto px-6 py-8 relative text-center text-xs text-muted-foreground">
        <span className="absolute left-6 top-1/2 -translate-y-1/2">
          v{APP_VERSION} · {GIT_SHA}
        </span>
        <span>© {new Date().getFullYear()} Admin Hub Solutions. All rights reserved.</span>
      </div>
    </footer>
  );
}
