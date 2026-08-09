// Loads the server-route type augmentation for createFileRoute.
import "@tanstack/react-start";

import { appRouter, createTRPCContext } from "@__SLUG__/trpc";
// __AUTH_IMPORT__
import { createFileRoute } from "@tanstack/react-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

function createContext(request: Request) {
  const headers = new Headers(request.headers);
  headers.set("x-trpc-source", "route");
  return createTRPCContext({ /* __AUTH_ARG__ */ headers });
}

function handler({ request }: { readonly request: Request }) {
  return fetchRequestHandler({
    req: request,
    router: appRouter,
    endpoint: "/api/trpc",
    createContext: () => createContext(request),
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(
              `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
            );
          }
        : undefined,
  });
}

export const Route = createFileRoute("/api/trpc/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
