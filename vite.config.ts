// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read .env directly (avoid importing from "vite" here — it creates a module
// require-cycle with the lovable config wrapper). We inject SERVER-ONLY secrets
// into the server bundle as compile-time constants. These end up only in
// dist/server (the Worker), never the client bundle, so they aren't exposed.
function readDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    // .env not present (e.g. CI) — fall back to process.env below.
  }
  return out;
}

const rootEnv = { ...readDotEnv(), ...process.env } as Record<string, string | undefined>;
const SERVER_DEFINE = {
  "globalThis.__SUPABASE_JWT_SECRET__": JSON.stringify(rootEnv.SUPABASE_JWT_SECRET ?? ""),
  "globalThis.__FIREBASE_PROJECT_ID__": JSON.stringify(
    rootEnv.VITE_FIREBASE_PROJECT_ID ?? ""
  ),
  // ServicePower credentials (SERVER ONLY — baked into dist/server, never the
  // client bundle). Runtime env plumbing is unreliable on Cloudflare Workers,
  // so we inject these as compile-time constants like the Supabase secret.
  "globalThis.__SP_USER_ID__": JSON.stringify(rootEnv.VITE_SERVICEPOWER_USER_ID ?? ""),
  "globalThis.__SP_PASSWORD__": JSON.stringify(rootEnv.VITE_SERVICEPOWER_PASSWORD ?? ""),
  "globalThis.__SP_ENV__": JSON.stringify(rootEnv.VITE_SERVICEPOWER_ENV ?? ""),
  "globalThis.__SP_REGION__": JSON.stringify(rootEnv.VITE_SERVICEPOWER_REGION ?? ""),
  "globalThis.__SP_SERVICER_ACCOUNT__": JSON.stringify(
    rootEnv.VITE_SERVICEPOWER_SERVICER_ACCOUNT ?? ""
  ),
  // Marcone mSupply credentials (SERVER ONLY — same pattern as SP secrets).
  "globalThis.__MARCONE_ENV__": JSON.stringify(rootEnv.VITE_MARCONE_ENV ?? "integration"),
  "globalThis.__MARCONE_INT_CLIENT_ID__": JSON.stringify(rootEnv.VITE_MARCONE_INT_CLIENT_ID ?? ""),
  "globalThis.__MARCONE_INT_CLIENT_SECRET__": JSON.stringify(
    rootEnv.VITE_MARCONE_INT_CLIENT_SECRET ?? ""
  ),
  "globalThis.__MARCONE_PROD_CLIENT_ID__": JSON.stringify(
    rootEnv.VITE_MARCONE_PROD_CLIENT_ID ?? ""
  ),
  "globalThis.__MARCONE_PROD_CLIENT_SECRET__": JSON.stringify(
    rootEnv.VITE_MARCONE_PROD_CLIENT_SECRET ?? ""
  ),
  // NSA Platform credentials (SERVER ONLY — never exposed to browser).
  "globalThis.__NSA_BASE_URL__": JSON.stringify(rootEnv.NSA_BASE_URL ?? "https://api.nsaweb.com"),
  "globalThis.__NSA_API_KEY__": JSON.stringify(rootEnv.NSA_API_KEY ?? ""),
  "globalThis.__NSA_SECRET__": JSON.stringify(rootEnv.NSA_SECRET ?? ""),
  // Firebase service account (SERVER ONLY — used by the Jotform webhook to
  // write notifications via the Firestore REST API; same reasoning as the
  // Supabase JWT secret above, never exposed to the client bundle).
  "globalThis.__FIREBASE_SA_EMAIL__": JSON.stringify(rootEnv.FIREBASE_SERVICE_ACCOUNT_EMAIL ?? ""),
  "globalThis.__FIREBASE_SA_PRIVATE_KEY__": JSON.stringify(
    rootEnv.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY ?? ""
  ),
  // Firebase Storage bucket (used by the Jotform webhook to re-host
  // file-upload answers — see mirrorSubmissionFiles in jotformBridge.ts).
  "globalThis.__FIREBASE_STORAGE_BUCKET__": JSON.stringify(rootEnv.VITE_FIREBASE_STORAGE_BUCKET ?? ""),
  // Jotform API key (SERVER ONLY) — Jotform's uploaded-file URLs are private
  // by default; this is required to actually download them for mirroring.
  "globalThis.__JOTFORM_API_KEY__": JSON.stringify(rootEnv.JOTFORM_API_KEY ?? ""),
  // Supabase service-role key (SERVER ONLY — the Jotform webhook uses this to
  // read `profiles` (role + extra_roles) directly, bypassing RLS, since the
  // webhook has no logged-in Supabase session to scope a normal query to.
  "globalThis.__SUPABASE_URL__": JSON.stringify(rootEnv.VITE_SUPABASE_URL ?? ""),
  "globalThis.__SUPABASE_SERVICE_KEY__": JSON.stringify(rootEnv.SUPABASE_SERVICE_KEY ?? ""),
};

// Dev-only middleware: serve /api/supabase-token locally (vite dev does not run
// the serverless api/ folder). Uses the SAME runtime-agnostic bridge as the
// production Worker so dev and prod behave identically.
function supabaseTokenDevPlugin() {
  return {
    name: "supabase-token-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/supabase-token", async (req: any, res: any) => {
        try {
          // Collect the request body and adapt the Node req into a web Request.
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks).toString("utf8");

          const { handleSupabaseTokenRequest } = await server.ssrLoadModule(
            "/src/lib/server/supabaseTokenBridge.ts"
          );
          const webReq = new Request("http://localhost/api/supabase-token", {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const webRes: Response = await handleSupabaseTokenRequest(webReq, process.env);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Token exchange failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/servicepower locally (vite dev does not run
// the serverless api/ folder). Uses the SAME runtime-agnostic bridge as the
// production Worker so dev and prod behave identically.
function servicePowerDevPlugin() {
  return {
    name: "servicepower-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/servicepower", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks).toString("utf8");

          const { handleServicePowerRequest } = await server.ssrLoadModule(
            "/src/lib/server/servicePowerBridge.ts"
          );
          const webReq = new Request("http://localhost/api/servicepower", {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          // Vite loads .env into import.meta.env (not process.env), so pass the
          // parsed .env values explicitly. .env wins over any stale process.env
          // value so the server-only SP creds are always the configured ones.
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleServicePowerRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "ServicePower request failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/marcone locally. Same shape as the SP
// plugin above — delegates to the runtime-agnostic bridge so dev and prod
// behave identically.
function marconeDevPlugin() {
  return {
    name: "marcone-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/marcone", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks).toString("utf8");

          const { handleMarconeRequest } = await server.ssrLoadModule(
            "/src/lib/server/marconeBridge.ts"
          );
          const webReq = new Request("http://localhost/api/marcone", {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleMarconeRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Marcone request failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/nsa locally. Same shape as the SP plugin.
function nsaDevPlugin() {
  return {
    name: "nsa-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/nsa", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks).toString("utf8");

          const { handleNsaRequest } = await server.ssrLoadModule(
            "/src/lib/server/nsaBridge.ts"
          );
          const webReq = new Request("http://localhost/api/nsa", {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleNsaRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "NSA request failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/jotform locally. Same shape as the other
// dev plugins above, but preserves the request's query string (?secret=...)
// since Jotform's webhook config has no custom-header option — the shared
// secret travels as a query param, unlike the other bridges' JSON-only bodies.
function jotformDevPlugin() {
  return {
    name: "jotform-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/jotform", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleJotformRequest } = await server.ssrLoadModule(
            "/src/lib/server/jotformBridge.ts"
          );
          const webReq = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/octet-stream" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleJotformRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Jotform webhook failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/custom-forms locally — same shape as
// jotformDevPlugin above (raw body passthrough so multipart/form-data file
// uploads survive intact), but also needs to work for GET (schema fetch),
// not just POST (submission).
function customFormsDevPlugin() {
  return {
    name: "custom-forms-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/custom-forms", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleCustomFormsRequest } = await server.ssrLoadModule(
            "/src/lib/server/customFormsBridge.ts"
          );
          const webReq = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/octet-stream" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleCustomFormsRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Custom form request failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/image-proxy locally — same bridge as
// production. Unlike the other dev plugins above, the response body is
// binary image bytes, not text/JSON, so it's streamed back as a Buffer
// (res.end(string) would corrupt binary data by round-tripping it through
// UTF-8) — and the query string (?url=...) must survive, so this builds
// the Request from req.url rather than a hardcoded path.
function imageProxyDevPlugin() {
  return {
    name: "image-proxy-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/image-proxy", async (req: any, res: any) => {
        try {
          const { handleImageProxyRequest } = await server.ssrLoadModule(
            "/src/lib/server/imageProxyBridge.ts"
          );
          const webReq = new Request(`http://localhost${req.url}`, { method: req.method });
          const webRes: Response = await handleImageProxyRequest(webReq);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(Buffer.from(await webRes.arrayBuffer()));
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Image proxy failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/google-drive locally — same bridge as
// production. Handles both the OAuth connect/callback (GET, ends in a
// redirect Response — res.statusCode + Location header forward that
// through as a real HTTP redirect) and the upload action (POST,
// multipart/form-data carrying the generated PDF — raw body passthrough
// like customFormsDevPlugin, since this carries binary file data too).
// Unlike the other dev plugins here, this one builds the internal Request
// from the real req.headers.host (not a hardcoded "localhost" with no
// port) — googleDriveBridge.ts derives its OAuth redirect_uri and the
// post-connect redirect target from the request's own origin, so getting
// the actual dev-server port right here actually matters, whereas none of
// the other bridges ever construct a URL back out of their own origin.
// Uses req.originalUrl (falling back to req.url) for the same reason:
// Connect's server.middlewares.use("/api/google-drive", ...) strips that
// mount prefix off req.url before this handler ever sees it, so
// reconstructing the URL from req.url alone silently drops "/api/google-drive"
// — req.originalUrl is Connect/Express's standard convention for the
// pre-strip, full original path.
function googleDriveDevPlugin() {
  return {
    name: "google-drive-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/google-drive", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleGoogleDriveRequest } = await server.ssrLoadModule(
            "/src/lib/server/googleDriveBridge.ts"
          );
          const webReq = new Request(`http://${req.headers.host ?? "localhost"}${req.originalUrl ?? req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/octet-stream" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleGoogleDriveRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Google Drive request failed" }));
        }
      });
    },
  };
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: SERVER_DEFINE,
    // Vite's default asset list doesn't include .pdf — needed so the blank
    // W-8BEN template (src/assets/w8ben-blank.pdf) resolves to a URL via a
    // plain `import` the same way the logo/ribbon/footer PNGs already do.
    assetsInclude: ["**/*.pdf"],
    // Dev-server only (never shipped in the Cloudflare production build):
    // lets a temporary cloudflared/ngrok tunnel hostname reach the local dev
    // server for testing webhooks (e.g. Jotform) that need a public URL.
    server: { allowedHosts: [".trycloudflare.com"] },
    plugins: [supabaseTokenDevPlugin(), servicePowerDevPlugin(), marconeDevPlugin(), nsaDevPlugin(), jotformDevPlugin(), customFormsDevPlugin(), imageProxyDevPlugin(), googleDriveDevPlugin()],
    build: {
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, "/");

            if (normalized.includes("/node_modules/")) {
              if (normalized.includes("/node_modules/@tanstack/")) return "tanstack";
              if (normalized.includes("/node_modules/@radix-ui/")) return "radix-ui";
              if (
                normalized.includes("/node_modules/react-dom/") ||
                normalized.includes("/node_modules/react/") ||
                normalized.includes("/node_modules/scheduler/") ||
                normalized.includes("/node_modules/loose-envify/") ||
                normalized.includes("/node_modules/js-tokens/") ||
                normalized.includes("/node_modules/use-sync-external-store/") ||
                normalized.includes("/node_modules/object-assign/")
              ) {
                return "react";
              }
              if (normalized.includes("/node_modules/lucide-react/")) return "icons";
              if (normalized.includes("/node_modules/recharts/")) return "charts";
              if (normalized.includes("/node_modules/react-hook-form/") || normalized.includes("/node_modules/@hookform/resolvers/") || normalized.includes("/node_modules/zod/")) return "forms";
              if (normalized.includes("/node_modules/date-fns/")) return "date-fns";
              if (normalized.includes("/node_modules/dexie/")) return "dexie";
              if (normalized.includes("/node_modules/sonner/")) return "sonner";
              if (
                normalized.includes("/node_modules/cmdk/") ||
                normalized.includes("/node_modules/embla-carousel-react/") ||
                normalized.includes("/node_modules/react-day-picker/") ||
                normalized.includes("/node_modules/react-resizable-panels/") ||
                normalized.includes("/node_modules/input-otp/") ||
                normalized.includes("/node_modules/vaul/")
              ) {
                return "interactive";
              }

              return "vendor";
            }

            if (normalized.includes("/src/lib/modules.ts")) return "module-registry";
            if (normalized.includes("/src/lib/")) return "app-lib";
            if (normalized.includes("/src/components/ui/")) return "ui-kit";
            if (normalized.includes("/src/components/")) return "app-components";
            if (normalized.includes("/src/hooks/")) return "app-hooks";

            return undefined;
          },
        },
      },
    },
  },
});
