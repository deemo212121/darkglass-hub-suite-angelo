/**
 * Marcone mSupply API Server-Side Endpoint (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/marconeBridge.ts.
 */

import { handleMarconeRequest } from "../src/lib/server/marconeBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleMarconeRequest(request, process.env as Record<string, string | undefined>);
}
