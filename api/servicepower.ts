/**
 * ServicePower API Server-Side Endpoint (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/servicePowerBridge.ts.
 */

import { handleServicePowerRequest } from "../src/lib/server/servicePowerBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleServicePowerRequest(request, process.env as Record<string, string | undefined>);
}
