import server from "../dist/server/index.js";

const serverEntry = server as {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

export const config = {
  runtime: "nodejs20.x",
};

export default async function handler(request: Request): Promise<Response> {
  return serverEntry.fetch(request, {}, {});
}