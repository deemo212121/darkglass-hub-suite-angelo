/**
 * Admin-triggered password reset (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/adminPasswordBridge.ts.
 */

import { handleAdminPasswordRequest } from "../src/lib/server/adminPasswordBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleAdminPasswordRequest(request, process.env as Record<string, string | undefined>);
}
