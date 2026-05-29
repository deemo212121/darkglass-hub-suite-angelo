import appServer from "../src/server";

export const runtime = "edge";

export default async function handler(request: Request): Promise<Response> {
  return appServer.fetch(request, undefined, undefined);
}