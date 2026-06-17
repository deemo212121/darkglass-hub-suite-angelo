// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import crypto from "node:crypto";

// Dev-only middleware: serve /api/supabase-token locally (vite dev does not run
// the serverless api/ folder). Mirrors api/supabase-token.ts logic.
function supabaseTokenDevPlugin() {
  const GOOGLE_CERTS_URL =
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
  const b64urlEnc = (input: Buffer | string) =>
    (typeof input === "string" ? Buffer.from(input, "utf8") : input)
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64urlDec = (input: string) =>
    Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");

  let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;
  async function getCerts() {
    if (certCache && certCache.expiresAt > Date.now()) return certCache.certs;
    const res = await fetch(GOOGLE_CERTS_URL);
    const certs = (await res.json()) as Record<string, string>;
    certCache = { certs, expiresAt: Date.now() + 3600_000 };
    return certs;
  }

  return {
    name: "supabase-token-dev",
    configureServer(server: any) {
      server.middlewares.use("/api/supabase-token", async (req: any, res: any) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return send(405, { error: "Method not allowed" });
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const { idToken } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if (!idToken) return send(400, { error: "Missing idToken" });

          const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
          const jwtSecret = process.env.SUPABASE_JWT_SECRET;
          if (!projectId) return send(500, { error: "Server missing VITE_FIREBASE_PROJECT_ID" });
          if (!jwtSecret) return send(500, { error: "Server missing SUPABASE_JWT_SECRET" });

          const [h, p, s] = String(idToken).split(".");
          const header = JSON.parse(b64urlDec(h).toString("utf8"));
          const claims = JSON.parse(b64urlDec(p).toString("utf8"));
          const now = Math.floor(Date.now() / 1000);
          if (claims.exp <= now) return send(401, { error: "Token expired" });
          if (claims.aud !== projectId) return send(401, { error: "Token audience mismatch" });
          if (claims.iss !== `https://securetoken.google.com/${projectId}`)
            return send(401, { error: "Token issuer mismatch" });

          const certs = await getCerts();
          const certPem = certs[header.kid];
          if (!certPem) return send(401, { error: "No matching Google cert" });
          const publicKey = new crypto.X509Certificate(certPem).publicKey;
          const verifier = crypto.createVerify("RSA-SHA256");
          verifier.update(`${h}.${p}`);
          verifier.end();
          if (!verifier.verify(publicKey, b64urlDec(s)))
            return send(401, { error: "Invalid token signature" });

          const exp = now + 3600;
          const headerB64 = b64urlEnc(JSON.stringify({ alg: "HS256", typ: "JWT" }));
          const payloadB64 = b64urlEnc(JSON.stringify({
            sub: claims.sub, role: "authenticated", aud: "authenticated",
            iss: "firebase-bridge", email: claims.email ?? "", iat: now, exp,
          }));
          const sig = b64urlEnc(
            crypto.createHmac("sha256", jwtSecret).update(`${headerB64}.${payloadB64}`).digest()
          );
          send(200, { token: `${headerB64}.${payloadB64}.${sig}`, expiresAt: exp, uid: claims.sub });
        } catch (err) {
          send(401, { error: err instanceof Error ? err.message : "Token exchange failed" });
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
    plugins: [supabaseTokenDevPlugin()],
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
