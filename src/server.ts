import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleSupabaseTokenRequest } from "./lib/server/supabaseTokenBridge";
import { handleServicePowerRequest } from "./lib/server/servicePowerBridge";
import { handleMarconeRequest } from "./lib/server/marconeBridge";
import { handleJotformRequest } from "./lib/server/jotformBridge";
import { handleNsaRequest } from "./lib/server/nsaBridge";
import { handleCustomFormsRequest } from "./lib/server/customFormsBridge";
import { handleImageProxyRequest } from "./lib/server/imageProxyBridge";
import { handleGoogleDriveRequest } from "./lib/server/googleDriveBridge";
import { handleSignableDocumentsRequest } from "./lib/server/signableDocumentsBridge";
import { handleLiveChatRequest } from "./lib/server/liveChatBridge";
import { handleAdminUpdateEmailRequest } from "./lib/server/adminUpdateEmailBridge";
import { handleLiveChatStaffRequest } from "./lib/server/liveChatStaffBridge";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

// Merge all available secret sources (Cloudflare bindings, adapter env,
// process.env), keeping the first defined, non-empty value per key. On
// Cloudflare the adapter `env` enumerates secret KEYS but returns undefined
// VALUES, so the canonical source is `env` from "cloudflare:workers".
async function resolveServerEnv(env: unknown): Promise<Record<string, string>> {
  let cfEnv: Record<string, unknown> = {};
  try {
    const mod = await import("cloudflare:workers");
    cfEnv = ((mod as any).env as Record<string, unknown>) ?? {};
  } catch {
    // not on Cloudflare (dev/Node) — ignore
  }
  const procEnv: Record<string, unknown> =
    typeof process !== "undefined" && process.env ? (process.env as any) : {};
  const adapterEnv = (env as Record<string, unknown>) ?? {};

  const merged: Record<string, string> = {};
  for (const src of [cfEnv, adapterEnv, procEnv]) {
    for (const k of Object.keys(src)) {
      const v = (src as any)[k];
      if (merged[k] === undefined && typeof v === "string" && v !== "") {
        merged[k] = v;
      }
    }
  }
  return merged;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Serve the Firebase -> Supabase token bridge AND the ServicePower bridge
    // from the Worker itself. Handled OUTSIDE the try/catch below so their JSON
    // error responses are returned verbatim instead of being swallowed into the
    // 500 HTML page.
    const url = new URL(request.url);
    if (url.pathname === "/api/supabase-token") {
      const merged = await resolveServerEnv(env);
      return await handleSupabaseTokenRequest(request, merged);
    }
    if (url.pathname === "/api/servicepower") {
      const merged = await resolveServerEnv(env);
      return await handleServicePowerRequest(request, merged);
    }
    if (url.pathname === "/api/marcone") {
      const merged = await resolveServerEnv(env);
      return await handleMarconeRequest(request, merged);
    }
    if (url.pathname === "/api/jotform") {
      const merged = await resolveServerEnv(env);
      return await handleJotformRequest(request, merged);
    }
    if (url.pathname === "/api/nsa") {
      const merged = await resolveServerEnv(env);
      return await handleNsaRequest(request, merged);
    }
    if (url.pathname === "/api/custom-forms") {
      const merged = await resolveServerEnv(env);
      return await handleCustomFormsRequest(request, merged);
    }
    if (url.pathname === "/api/image-proxy") {
      return await handleImageProxyRequest(request);
    }
    if (url.pathname === "/api/google-drive") {
      const merged = await resolveServerEnv(env);
      return await handleGoogleDriveRequest(request, merged);
    }
    if (url.pathname === "/api/signable-documents") {
      const merged = await resolveServerEnv(env);
      return await handleSignableDocumentsRequest(request, merged);
    }
    if (url.pathname === "/api/live-chat") {
      const merged = await resolveServerEnv(env);
      return await handleLiveChatRequest(request, merged);
    }
    if (url.pathname === "/api/live-chat-staff") {
      const merged = await resolveServerEnv(env);
      return await handleLiveChatStaffRequest(request, merged);
    }
    if (url.pathname === "/api/admin-update-email") {
      const merged = await resolveServerEnv(env);
      return await handleAdminUpdateEmailRequest(request, merged);
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },

  // Cron Trigger (see wrangler.jsonc "triggers.crons") — dispatches on which
  // schedule fired: hourly runs the NSA parts pull (and, once a week, the
  // password reset check below), every 5 minutes runs the attendance
  // grace-period check.
  async scheduled(event: { cron?: string }, env: unknown, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    const merged = await resolveServerEnv(env);

    if (event?.cron === "*/5 * * * *") {
      ctx.waitUntil(
        import("./lib/server/attendanceAlerts").then(
          ({ runAttendanceAlertCheck }) => runAttendanceAlertCheck(merged),
        ).then(
          (result) => console.log("attendanceAlerts:", JSON.stringify(result)),
          (error) => console.error("attendanceAlerts failed:", error),
        ),
      );
      return;
    }

    ctx.waitUntil(
      import("./lib/server/nsaPartsSync").then(
        ({ runNsaPartsSync }) => runNsaPartsSync(merged),
      ).then(
        (result) => console.log("nsaPartsSync:", JSON.stringify(result)),
        (error) => console.error("nsaPartsSync failed:", error),
      ),
    );

    // No separate cron entry for this — the hourly tick above lands on an
    // exact America/Chicago hour boundary too (see passwordResetSchedule.ts's
    // header comment), so this just checks "is it Monday 00:00 Chicago time
    // right now" every time the hourly cron fires anyway.
    ctx.waitUntil(
      import("./lib/server/passwordResetSchedule").then(({ isWeeklyPasswordResetTick, runWeeklyPasswordReset }) =>
        isWeeklyPasswordResetTick() ? runWeeklyPasswordReset(merged) : null,
      ).then(
        (result) => { if (result) console.log("weeklyPasswordReset:", JSON.stringify(result)); },
        (error) => console.error("weeklyPasswordReset failed:", error),
      ),
    );
  },
};
