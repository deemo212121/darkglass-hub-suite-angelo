/**
 * Signable Documents — external (no-login) sign endpoint (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/signableDocumentsBridge.ts.
 */

import { handleSignableDocumentsRequest } from "../src/lib/server/signableDocumentsBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleSignableDocumentsRequest(request, process.env as Record<string, string | undefined>);
}
