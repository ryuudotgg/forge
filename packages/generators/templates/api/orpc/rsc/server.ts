import { appRouter } from "@__SLUG__/orpc";
import { createRouterClient } from "@orpc/server";

globalThis.$client = createRouterClient(appRouter, {
  context: async () => {
    // A static next/headers import breaks the client component SSR build.
    const { headers } = await import("next/headers");

    return { headers: await headers() };
  },
});
