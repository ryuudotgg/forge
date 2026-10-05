import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { preflight, withCors } from "./lib/api-cors";

export function proxy(request: NextRequest) {
  if (request.method === "OPTIONS") return preflight(request);
  return withCors(request, NextResponse.next());
}

export const config = { matcher: ["/api/auth/:path*", "/api/trpc/:path*"] };
