// Minimal ambient declaration for the "cloudflare:workers" module specifier,
// used only by server.ts's dynamic `import("cloudflare:workers")` (wrapped
// in try/catch — this module only exists at runtime when actually deployed
// to Cloudflare Workers, not in dev/Node). Deliberately NOT using the full
// @cloudflare/workers-types package here: that package redefines Response,
// Request, fetch, ReadableStream, etc. as globals, which conflict with this
// project's "DOM" lib (this is primarily a browser app with one small
// server entry file, not a Workers-only project).
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
