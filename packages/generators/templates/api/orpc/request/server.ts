__AUTH_IMPORT__;
import { appRouter, createORPCContext } from "@__SLUG__/orpc";
import { createRouterClient } from "@orpc/server";

export async function createServerCaller(request: Request) {
  const context = await createORPCContext({ __AUTH_ARG__, headers: request.headers });
  return createRouterClient(appRouter, { context });
}
