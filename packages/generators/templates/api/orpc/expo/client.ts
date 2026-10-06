import type { AppRouter } from "@__SLUG__/orpc";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins";
import type { RouterClient } from "@orpc/server";
import { env } from "../../env";
__AUTH_IMPORT__;

const link = new RPCLink({
  url: `${env.EXPO_PUBLIC_SERVER_URL}/api/orpc`,
  __AUTH_HEADERS__,
  plugins: [new SimpleCsrfProtectionLinkPlugin()],
});

export const client: RouterClient<AppRouter> = createORPCClient(link);
