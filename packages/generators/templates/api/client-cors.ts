const defaultOrigins = __WEB_ORIGINS__;
function headersFor(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = process.env.WEB_URLS?.split(",") ?? defaultOrigins;
  if (origin === null || !allowedOrigins.includes(origin)) return null;

  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-trpc-source, x-csrf-token, trpc-accept",
    Vary: "Origin",
  });
}

export function preflight(request: Request) {
  const headers = headersFor(request);
  return headers === null ? new Response(null, { status: 403 }) : new Response(null, { status: 204, headers });
}

export async function withCors(request: Request, response: Response | Promise<Response>) {
  const result = await response;
  const headers = headersFor(request);
  if (headers === null) return result;

  const copy = new Response(result.body, result);
  const vary = copy.headers.get("Vary");
  headers.forEach((value, name) => copy.headers.set(name, value));

  if (vary !== null)
    copy.headers.set(
      "Vary",
      vary === "*" || vary.split(",").some((value) => value.trim().toLowerCase() === "origin")
        ? vary
        : `${vary}, Origin`,
    );

  return copy;
}
