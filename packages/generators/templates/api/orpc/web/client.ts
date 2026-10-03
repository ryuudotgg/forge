import type { AppRouter } from "@__SLUG__/orpc";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { env } from "../../env";

const link = new RPCLink({
  url: `${env.VITE_SERVER_URL}/api/orpc`,
  fetch: (request, init) =>
    globalThis.fetch(request, {
      ...init,
      credentials: "include",
    }),
  plugins: [new SimpleCsrfProtectionLinkPlugin()],
});

export const client: RouterClient<AppRouter> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
