// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// Windows-only build race: @cloudflare/vite-plugin's client-build phase
// spawns a local workerd instance that doesn't reliably exit before the
// very next ssr-build phase starts — and Vite's own out-dir-emptying step
// (build.emptyOutDir, on by default) then fails with EBUSY trying to rmdir
// dist/server/.wrangler/state/v3/cache while that process still holds a
// lock on it. Neither disabling wrangler's state persistence nor
// relocating it actually stops the directory from being created and raced
// over — the fix instead sidesteps Vite's crash-prone cleanup entirely:
// clean dist/ ourselves, once, synchronously, here at config-load time
// (before any environment's build — and therefore before workerd — has
// started), then tell both environments not to try emptying it again
// (see emptyOutDir: false below) so nothing ever attempts to touch a path
// workerd might still be holding open partway through the build.
//
// This alone isn't quite enough, though: a PRIOR build/test run's workerd
// process can still be alive and holding the same lock at the moment THIS
// rmSync call itself runs (observed in practice — a leftover workerd from
// an earlier session). maxRetries/retryDelay is Node's own built-in
// mechanism for exactly this class of transient Windows EBUSY/EPERM lock —
// retry a few times with a short pause instead of failing on the first hit.
rmSync(resolve(process.cwd(), "dist"), {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 300,
});

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
  // Encompass Supply Chain Solutions credentials (SERVER ONLY). Simpler
  // than Marcone's — no OAuth token, jsonUser/jsonPassword go on every
  // request, so there's nothing to cache, just the two secrets + env pick.
  "globalThis.__ENCOMPASS_ENV__": JSON.stringify(rootEnv.VITE_ENCOMPASS_ENV ?? "test"),
  "globalThis.__ENCOMPASS_JSON_USER__": JSON.stringify(rootEnv.VITE_ENCOMPASS_JSON_USER ?? ""),
  "globalThis.__ENCOMPASS_JSON_PASSWORD__": JSON.stringify(rootEnv.VITE_ENCOMPASS_JSON_PASSWORD ?? ""),
  "globalThis.__ENCOMPASS_CUSTOMER_NUMBER__": JSON.stringify(rootEnv.VITE_ENCOMPASS_CUSTOMER_NUMBER ?? ""),
  "globalThis.__ENCOMPASS_CUSTOMER_PASSWORD__": JSON.stringify(rootEnv.VITE_ENCOMPASS_CUSTOMER_PASSWORD ?? ""),
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

// Dev-only middleware: serve /api/encompass locally. Same shape as the
// Marcone plugin.
function encompassDevPlugin() {
  return {
    name: "encompass-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/encompass", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks).toString("utf8");

          const { handleEncompassRequest } = await server.ssrLoadModule(
            "/src/lib/server/encompassBridge.ts"
          );
          const webReq = new Request("http://localhost/api/encompass", {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleEncompassRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Encompass request failed" }));
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

// Dev-only middleware: serve /api/signable-documents locally — same shape
// as customFormsDevPlugin above (GET for the doc, POST multipart for the
// signature + PDF upload).
function signableDocumentsDevPlugin() {
  return {
    name: "signable-documents-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/signable-documents", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleSignableDocumentsRequest } = await server.ssrLoadModule(
            "/src/lib/server/signableDocumentsBridge.ts"
          );
          const webReq = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/octet-stream" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleSignableDocumentsRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Signable document request failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/live-chat locally — same shape as
// signableDocumentsDevPlugin above. Body is plain JSON for most POST
// actions (GET for polling, start/message/typing), except action=upload
// which is multipart/form-data (a photo attachment) — the raw chunks are
// passed through with whatever content-type the browser actually sent, so
// the multipart boundary survives regardless of which action this is.
function liveChatDevPlugin() {
  return {
    name: "live-chat-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/live-chat", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleLiveChatRequest } = await server.ssrLoadModule("/src/lib/server/liveChatBridge.ts");
          const webReq = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleLiveChatRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Live chat request failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/live-chat-staff locally — same shape as
// liveChatDevPlugin above, plain JSON only (no multipart action here).
function liveChatStaffDevPlugin() {
  return {
    name: "live-chat-staff-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/live-chat-staff", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleLiveChatStaffRequest } = await server.ssrLoadModule("/src/lib/server/liveChatStaffBridge.ts");
          const webReq = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleLiveChatStaffRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Live chat staff request failed" }));
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

// Dev-only middleware: serve /api/gmail locally — same shape as
// googleDriveDevPlugin above (real host/port in the reconstructed URL,
// req.originalUrl so the "/api/gmail" prefix Connect strips off req.url
// survives, since gmailBridge.ts also derives its OAuth redirect_uri from
// the request's own origin).
function gmailDevPlugin() {
  return {
    name: "gmail-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/gmail", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleGmailRequest } = await server.ssrLoadModule("/src/lib/server/gmailBridge.ts");
          const webReq = new Request(`http://${req.headers.host ?? "localhost"}${req.originalUrl ?? req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleGmailRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Gmail request failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/admin-update-email locally — same bridge
// as production. Plain JSON POST, same shape as liveChatDevPlugin minus the
// multipart-upload branch (this route never carries a file).
function adminUpdateEmailDevPlugin() {
  return {
    name: "admin-update-email-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/admin-update-email", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleAdminUpdateEmailRequest } = await server.ssrLoadModule("/src/lib/server/adminUpdateEmailBridge.ts");
          const webReq = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleAdminUpdateEmailRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Email update request failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/admin-reset-password locally — same
// bridge as production. Plain JSON POST, same shape as adminUpdateEmailDevPlugin.
function adminResetPasswordDevPlugin() {
  return {
    name: "admin-reset-password-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/admin-reset-password", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleAdminPasswordRequest } = await server.ssrLoadModule("/src/lib/server/adminPasswordBridge.ts");
          const webReq = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleAdminPasswordRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Password reset request failed" }));
        }
      });
    },
  };
}

// Dev-only middleware: serve /api/login-lockout locally — same bridge as
// production. Plain JSON POST, same shape as adminResetPasswordDevPlugin.
function loginLockoutDevPlugin() {
  return {
    name: "login-lockout-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/login-lockout", async (req: any, res: any) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = Buffer.concat(chunks);

          const { handleLoginLockoutRequest } = await server.ssrLoadModule("/src/lib/server/loginLockoutBridge.ts");
          const webReq = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] ?? "application/json" },
            body: req.method === "POST" ? body : undefined,
          });
          const mergedEnv = { ...process.env, ...readDotEnv() } as Record<string, string | undefined>;
          const webRes: Response = await handleLoginLockoutRequest(webReq, mergedEnv);

          res.statusCode = webRes.status;
          webRes.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await webRes.text());
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Login lockout request failed" }));
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
  // Production builds are one-shot — nothing needs local Wrangler state
  // persisted across runs. See the rmSync/emptyOutDir notes above for the
  // actual EBUSY fix; this just avoids writing the sqlite cache files into
  // the build output in the first place.
  cloudflare: { viteEnvironment: { name: "ssr" }, persistState: false },
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
    plugins: [supabaseTokenDevPlugin(), servicePowerDevPlugin(), marconeDevPlugin(), encompassDevPlugin(), nsaDevPlugin(), jotformDevPlugin(), customFormsDevPlugin(), imageProxyDevPlugin(), googleDriveDevPlugin(), gmailDevPlugin(), signableDocumentsDevPlugin(), liveChatDevPlugin(), liveChatStaffDevPlugin(), adminUpdateEmailDevPlugin(), adminResetPasswordDevPlugin(), loginLockoutDevPlugin()],
    build: {
      chunkSizeWarningLimit: 800,
      // See the rmSync call above — we clean dist/ ourselves once, up
      // front, so Vite's own crash-prone out-dir-emptying step (which
      // races against a lingering workerd process on Windows) never runs.
      emptyOutDir: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, "/");

            if (normalized.includes("/node_modules/")) {
              // Leaflet is browser-only (touches `window` at module load, not
              // just when called) and is only ever reached via a dynamic
              // import() (see getLeaflet() in mapEngine.ts), never a static
              // import — so it must land in its OWN chunk, separate from the
              // catch-all "vendor" bucket below. That bucket also holds
              // genuinely SSR-eager deps (Supabase, Firebase, ...), so if
              // Leaflet shared it, the whole chunk — Leaflet included — would
              // still be eagerly evaluated by the server entry, crashing
              // Cloudflare Workers (no `window`) before any request is even
              // handled, regardless of the dynamic import() at the call site.
              if (normalized.includes("/node_modules/leaflet/")) return "leaflet";
              // Same reasoning as Leaflet above: heic2any's own module does
              // `import "./libheif"` / `import "./gifshot"` at its top level,
              // both of which touch `window` at load time, not just when
              // called. It's only ever reached via a dynamic import() inside
              // compressImage() (src/lib/imageCompression.ts), itself only
              // called from a browser file-input handler — but sharing the
              // "vendor" bucket with SSR-eager deps meant the Cloudflare
              // Worker crashed on `window is not defined` at startup, before
              // handling any request, regardless of that dynamic import().
              // browser-image-compression is bundled alongside it since it's
              // only ever imported from the same call site, for the same
              // reason.
              if (
                normalized.includes("/node_modules/heic2any/") ||
                normalized.includes("/node_modules/browser-image-compression/")
              ) {
                return "image-compression";
              }
              // Same reasoning again: pdfjs-dist touches browser globals
              // (DOMMatrix, document, Worker, canvas) at module load, and is
              // only ever reached via a dynamic import() inside the
              // Fill*Page components (FillW4Page.tsx etc.) — but the
              // "vendor" bucket is eagerly evaluated by the Cloudflare
              // Worker regardless of that dynamic import(), so it needs its
              // own chunk too. Exclude the `?url` worker-asset import
              // (pdfjs-dist/build/pdf.worker.min.mjs?url) — that one IS
              // statically imported by the Fill*Page components, and
              // grouping it into the same chunk as the real dynamically-
              // imported library code would merge them into one physical
              // chunk, making the whole thing a static (eager) dependency
              // again — exactly the bug this isolation exists to prevent.
              // Left to fall through, it resolves as a plain build-time URL
              // constant, same as the PNG asset imports elsewhere.
              if (
                normalized.includes("/node_modules/pdfjs-dist/") &&
                !normalized.endsWith("?url")
              ) {
                return "pdfjs-dist";
              }
              // pdf-lib is left in "vendor": it's pure JS PDF manipulation
              // with no DOM dependency, so it's SSR-safe.
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
            // Was its own "app-lib" chunk; merged into "vendor" because the
            // two had grown into a genuine circular chunk dependency
            // ("Circular chunk: vendor -> app-lib -> vendor" in the build
            // log) — several src/lib files are reachable both by static
            // import (e.g. from ReportHRDaily.tsx) and by dynamic import
            // (e.g. from auth.tsx) at once, and Rollup has to split the
            // physical files across the two chunks either way. At runtime
            // this surfaced as `Uncaught ReferenceError: Cannot access 'X'
            // before initialization` — a module in one chunk trying to read
            // an export from the other chunk before its own top-level code
            // had finished running. Putting them in the same chunk removes
            // the boundary (and the ordering hazard) entirely.
            if (normalized.includes("/src/lib/")) return "vendor";
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
