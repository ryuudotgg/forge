// __AUTH_IMPORT__
import { appRouter, createTRPCContext } from "@__SLUG__/trpc";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";

function headersFromRequest(headers: FastifyRequest["headers"]) {
  const result = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else result.set(name, value);
  }

  return result;
}

export function registerTrpcRoutes(app: FastifyInstance) {
  app.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    trpcOptions: {
      createContext: ({ req }: { req: FastifyRequest }) =>
        createTRPCContext({
          /* __AUTH_ARG__ */
          headers: headersFromRequest(req.headers),
        }),
      router: appRouter,
    },
  });
}
