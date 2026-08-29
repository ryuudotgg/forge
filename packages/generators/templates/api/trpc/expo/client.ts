import type { AppRouter } from "@__SLUG__/trpc";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";
// __AUTH_IMPORT__
import { env } from "../../env";

export const queryClient = new QueryClient();

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      transformer: SuperJSON,
      url: `${env.EXPO_PUBLIC_SERVER_URL}/api/trpc`,
      // __AUTH_HEADERS__
    }),
  ],
});
