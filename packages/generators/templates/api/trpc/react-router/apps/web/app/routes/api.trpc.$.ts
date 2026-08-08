import { appRouter, createTRPCContext } from "@__SLUG__/trpc";
// __AUTH_IMPORT__
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

function createContext(request: Request) {
  const headers = new Headers(request.headers);
  headers.set("x-trpc-source", "route");
  return createTRPCContext({ /* __AUTH_ARG__ */ headers });
}

function handler({ request }: LoaderFunctionArgs | ActionFunctionArgs) {
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

export const loader = (args: LoaderFunctionArgs) => handler(args);
export const action = (args: ActionFunctionArgs) => handler(args);
