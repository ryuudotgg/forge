// __AUTH_IMPORT__
import { appRouter, createTRPCContext } from "@__SLUG__/trpc";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";

__HEADERS_FROM_REQUEST__

export function registerTrpcRoutes(app: FastifyInstance) {
  app.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    trpcOptions: {
      createContext: ({ req }: { req: FastifyRequest }) =>
        createTRPCContext({
          /* __AUTH_ARG__ */
          headers: headersFromRequest(req.headers),
        }),
      responseMeta: () => ({ headers: { vary: ["Origin"] } }),
      router: appRouter,
    },
  });
}
