// __AUTH_IMPORT__
import { createCaller, createTRPCContext } from "@__SLUG__/trpc";

export async function createServerCaller(request: Request) {
  const headers = new Headers(request.headers);
  headers.set("x-trpc-source", "server");

  const context = await createTRPCContext({ /* __AUTH_ARG__ */ headers });
  return createCaller(context);
}
