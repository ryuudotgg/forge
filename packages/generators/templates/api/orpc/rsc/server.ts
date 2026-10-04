import "server-only";
__AUTH_IMPORT__;
import { appRouter, createORPCContext } from "@__SLUG__/orpc";
import { createRouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { headers } from "next/headers";
import { cache } from "react";

export const createServerCaller = cache(async () => {
  const requestHeaders = await headers();
  const context = await createORPCContext({ __AUTH_ARG__, headers: requestHeaders });
  return createRouterClient(appRouter, { context });
});

export async function createServerORPC() {
  const client = await createServerCaller();
  return createTanstackQueryUtils(client);
}
