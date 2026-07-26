/**
 * Image proxy — fetches a Firebase Storage image server-side so document
 * generation (Logo/signature images) works even when the storage bucket has
 * no CORS configuration (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/imageProxyBridge.ts.
 */

import { handleImageProxyRequest } from "../src/lib/server/imageProxyBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleImageProxyRequest(request);
}
