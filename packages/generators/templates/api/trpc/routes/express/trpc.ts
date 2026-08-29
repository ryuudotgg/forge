// __AUTH_IMPORT__
import { appRouter, createTRPCContext } from "@__SLUG__/trpc";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { Express, Request } from "express";

function headersFromRequest(headers: Request["headers"]) {
  const result = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else result.set(name, value);
  }

  return result;
}

export function registerTrpcRoutes(app: Express) {
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      createContext: ({ req }) =>
        createTRPCContext({
          /* __AUTH_ARG__ */
          headers: headersFromRequest(req.headers),
        }),
      router: appRouter,
    }),
  );
}
