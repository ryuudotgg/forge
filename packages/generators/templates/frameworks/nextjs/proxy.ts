import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const defaultOrigins = __WEB_ORIGINS__;
export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowedOrigins = process.env.WEB_URLS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? defaultOrigins;
  if (origin === null || !allowedOrigins.includes(origin)) return NextResponse.next();

  const headers = new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-trpc-source, x-csrf-token, trpc-accept",
    Vary: "Origin",
  });

  if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });

  const response = NextResponse.next();
  const vary = response.headers.get("Vary");
  headers.forEach((value, name) => response.headers.set(name, value));

  if (vary !== null)
    response.headers.set(
      "Vary",
      vary === "*" || vary.split(",").some((value) => value.trim().toLowerCase() === "origin")
        ? vary
        : `${vary}, Origin`,
    );

  return response;
}

export const config = { matcher: ["/api/auth/:path*", "/api/trpc/:path*"] };
