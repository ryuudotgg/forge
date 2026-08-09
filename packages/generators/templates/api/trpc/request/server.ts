import { createCaller, createTRPCContext } from "@__SLUG__/trpc";
// __AUTH_IMPORT__

export async function createServerCaller(request: Request) {
  const headers = new Headers(request.headers);
  headers.set("x-trpc-source", "server");

  const context = await createTRPCContext({ /* __AUTH_ARG__ */ headers });
  return createCaller(context);
}
