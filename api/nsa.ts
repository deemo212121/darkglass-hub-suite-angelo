/**
 * NSA Platform API server-side endpoint.
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave identically.
 */

import { handleNsaRequest } from "../src/lib/server/nsaBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleNsaRequest(request, process.env as Record<string, string | undefined>);
}
