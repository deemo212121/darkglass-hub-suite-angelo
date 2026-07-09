import server from "../../dist/server/index.js";

const serverEntry = server as {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type NetlifyEvent = {
  httpMethod: string;
  headers?: Record<string, string | undefined>;
  rawUrl?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
};

function toRequest(event: NetlifyEvent): Request {
  const requestUrl = event.rawUrl ?? "https://example.com/";
  const headers = new Headers();

  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value != null) {
      headers.set(key, value);
    }
  }

  const method = event.httpMethod.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = !hasBody
    ? undefined
    : event.body == null
      ? undefined
      : event.isBase64Encoded
        ? Uint8Array.from(Buffer.from(event.body, "base64"))
        : event.body;

  return new Request(requestUrl, {
    method,
    headers,
    body,
  });
}

export const handler = async (event: NetlifyEvent): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}> => {
  const response = await serverEntry.fetch(toRequest(event), {}, {});
  const responseHeaders: Record<string, string> = {};

  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const bodyBuffer = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const textLike =
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("javascript") ||
    contentType.includes("xml") ||
    contentType.includes("svg");

  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: textLike ? new TextDecoder().decode(bodyBuffer) : Buffer.from(bodyBuffer).toString("base64"),
    isBase64Encoded: !textLike,
  };
};