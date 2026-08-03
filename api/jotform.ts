/**
 * Jotform Webhook Server-Side Endpoint (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/jotformBridge.ts.
 */

import { handleJotformRequest } from "../src/lib/server/jotformBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleJotformRequest(request, process.env as Record<string, string | undefined>);
}
