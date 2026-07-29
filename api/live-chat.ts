/**
 * Live Chat — public (no-login) landing-page widget endpoint (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/liveChatBridge.ts.
 */

import { handleLiveChatRequest } from "../src/lib/server/liveChatBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleLiveChatRequest(request, process.env as Record<string, string | undefined>);
}
