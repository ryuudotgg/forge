__WEB_ORIGINS__

export function preflight(request: Request) {
  const headers = corsHeaders(request);
  if (!headers.has("Access-Control-Allow-Origin"))
    return new Response(null, { status: 403, headers });

  headers.set("Access-Control-Max-Age", "600");
  return new Response(null, { status: 204, headers });
}

export async function withCors(
  request: Request,
  response: Response | Promise<Response>,
) {
  const result = await response;
  const copy = new Response(result.body, result);
  const vary = copy.headers.get("Vary");

  corsHeaders(request).forEach((value, name) => {
    copy.headers.set(name, value);
  });

  copy.headers.set("Vary", withOrigin(vary));
  return copy;
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers({ Vary: "Origin" });
  if (origin === null || !webOrigins.includes(origin)) return headers;

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-trpc-source, x-csrf-token, trpc-accept",
  );

  return headers;
}

function withOrigin(vary: string | null) {
  if (vary === null) return "Origin";

  const values = vary.split(",").map((value) => value.trim().toLowerCase());
  return values.includes("*") || values.includes("origin")
    ? vary
    : `${vary}, Origin`;
}
