/**
 * "Connect Google Drive" OAuth + upload endpoint (production / serverless).
 *
 * Delegates to the shared runtime-agnostic bridge so dev and prod behave
 * identically. See src/lib/server/googleDriveBridge.ts.
 */

import { handleGoogleDriveRequest } from "../src/lib/server/googleDriveBridge";

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return handleGoogleDriveRequest(request, process.env as Record<string, string | undefined>);
}
