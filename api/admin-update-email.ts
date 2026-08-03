/**
 * Admin "update user email" server-side endpoint (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/adminUpdateEmailBridge.ts.
 */

import { handleAdminUpdateEmailRequest } from "../src/lib/server/adminUpdateEmailBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleAdminUpdateEmailRequest(request, process.env as Record<string, string | undefined>);
}
