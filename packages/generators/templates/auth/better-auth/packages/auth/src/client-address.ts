import { env } from "@__SLUG__/auth/env";

export const trustedProxies = (env.AUTH_TRUSTED_PROXIES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

export const clientIpHeader =
  env.AUTH_CLIENT_IP_HEADER?.trim() || "x-forwarded-for";

export function forwardedFor(
  inbound: string | null | undefined,
  socket: string | undefined,
): string | undefined {
  if (env.AUTH_CLIENT_IP_HEADER?.trim()) return inbound ?? undefined;
  if (!socket) return undefined;
  if (trustedProxies.length === 0) return socket;
  return inbound ? `${inbound}, ${socket}` : socket;
}

export function withClientAddress(
  request: Request,
  socket: string | undefined,
): Request {
  const headers = new Headers(request.headers);
  const address = forwardedFor(headers.get("x-forwarded-for"), socket);
  if (address === undefined) headers.delete("x-forwarded-for");
  else headers.set("x-forwarded-for", address);

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: request.body,
    ...(request.body ? { duplex: "half" } : {}),
    signal: request.signal,
  };

  return new Request(request.url, init);
}
