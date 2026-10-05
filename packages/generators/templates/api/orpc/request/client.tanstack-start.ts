__AUTH_IMPORT__;
import { type AppRouter, appRouter, createORPCContext } from "@__SLUG__/orpc";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

const getClient = createIsomorphicFn()
  .server(
    (): RouterClient<AppRouter> =>
      createRouterClient(appRouter, {
        context: () => {
          const { headers } = getRequest();
          return createORPCContext({ __AUTH_ARG__, headers });
        },
      }),
  )
  .client((): RouterClient<AppRouter> => {
    const link = new RPCLink({
      url: () => new URL("/api/orpc", window.location.origin),
      fetch: (request, init) =>
        globalThis.fetch(request, {
          ...init,
          credentials: "include",
        }),
      plugins: [new SimpleCsrfProtectionLinkPlugin()],
    });

    return createORPCClient(link);
  });

export const client: RouterClient<AppRouter> = getClient();
export const orpc = createTanstackQueryUtils(client);
