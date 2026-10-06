import { join } from "node:path";
import { createRequestHandler } from "react-router";
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";
import * as build from "./build/server/index.js";

const handler = createRequestHandler(build, process.env.NODE_ENV);
const client = join(import.meta.dirname, "build/client");
const files = staticMiddleware({ dir: client, maxAge: 0 });
const assets = staticMiddleware({
  dir: client,
  immutable: true,
  maxAge: 31_536_000,
});

const compressible = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;

function acceptsGzip(request) {
  const encodings = request.headers.get("accept-encoding") ?? "";
  const quality = new Map(
    encodings.split(",").map((entry) => {
      const [name, ...params] = entry.split(";").map((part) => part.trim());
      const q = params.find((param) => param.startsWith("q="));

      return [name, q === undefined ? 1 : Number(q.slice(2))];
    }),
  );

  return (quality.get("gzip") ?? quality.get("*") ?? 0) > 0;
}

async function compress(request, next) {
  const response = await next();
  if (
    response.body === null ||
    response.headers.has("content-encoding") ||
    response.headers.has("content-range") ||
    !compressible.test(response.headers.get("content-type") ?? "") ||
    !acceptsGzip(request)
  )
    return response;

  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  headers.append("vary", "accept-encoding");

  const body = response.body.pipeThrough(new CompressionStream("gzip"));

  return new Response(body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

serve({
  fetch: (request) => handler(request),
  gracefulShutdown: true,
  middleware: [
    compress,
    (request, next) =>
      new URL(request.url).pathname.startsWith("/assets/")
        ? assets(request, next)
        : files(request, next),
  ],
});
