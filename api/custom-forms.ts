/**
 * Custom Forms — public fill/submit endpoint (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/customFormsBridge.ts.
 */

import { handleCustomFormsRequest } from "../src/lib/server/customFormsBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleCustomFormsRequest(request, process.env as Record<string, string | undefined>);
}
