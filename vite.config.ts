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

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: SERVER_DEFINE,
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
