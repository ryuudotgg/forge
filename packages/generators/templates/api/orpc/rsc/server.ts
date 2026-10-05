import "server-only";
import { appRouter } from "@__SLUG__/orpc";
import { createRouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { headers } from "next/headers";
import { cache } from "react";

export const createServerCaller = cache(async () => {
  const requestHeaders = await headers();
  return createRouterClient(appRouter, {
    context: { headers: requestHeaders },
  });
});

export async function createServerORPC() {
  const client = await createServerCaller();
  return createTanstackQueryUtils(client);
}
