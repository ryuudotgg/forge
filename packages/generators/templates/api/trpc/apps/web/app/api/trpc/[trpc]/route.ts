import { appRouter, createTRPCContext } from "@__SLUG__/trpc";
__AUTH_IMPORT__import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

function createContext(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-trpc-source", "route");
  return createTRPCContext({ __AUTH_ARG__headers });
}

function handler(req: NextRequest) {
  return fetchRequestHandler({
    req,
    router: appRouter,
    endpoint: "/api/trpc",
    createContext: () => createContext(req),
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

export { handler as GET, handler as POST };
