/**
 * ServicePower API endpoint (legacy location).
 *
 * The active endpoint is served from the root `api/servicepower.ts` in
 * production and the Vite dev middleware in development — both delegate to the
 * shared bridge below. This file is kept only as a thin re-export to avoid
 * duplicate logic.
 */

import { handleServicePowerRequest } from "@/lib/server/servicePowerBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleServicePowerRequest(
    request,
    typeof process !== "undefined" ? (process.env as Record<string, string | undefined>) : undefined
  );
}
