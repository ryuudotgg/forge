// __AUTH_IMPORT__
import { appRouter, createTRPCContext } from "@__SLUG__/trpc";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { Express, Request } from "express";

__HEADERS_FROM_REQUEST__

export function registerTrpcRoutes(app: Express) {
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      createContext: ({ req }) =>
        createTRPCContext({
          /* __AUTH_ARG__ */
          headers: headersFromRequest(req.headers),
        }),
      responseMeta: () => ({ headers: { vary: ["Origin"] } }),
      router: appRouter,
    }),
  );
}
