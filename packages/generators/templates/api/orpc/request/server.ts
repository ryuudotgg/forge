import { appRouter } from "@__SLUG__/orpc";
import { createRouterClient } from "@orpc/server";

export function createServerCaller(request: Request) {
  return createRouterClient(appRouter, {
    context: { headers: request.headers },
  });
}
