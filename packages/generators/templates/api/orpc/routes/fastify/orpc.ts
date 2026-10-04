__AUTH_IMPORT__;
import { appRouter, createORPCContext } from "@__SLUG__/orpc";
import { RPCHandler } from "@orpc/server/fastify";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import type { FastifyInstance, FastifyRequest } from "fastify";

function headersFromRequest(headers: FastifyRequest["headers"]) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;

    if (Array.isArray(value))
      for (const item of value) result.append(name, item);
    else result.set(name, value);
  }

  return result;
}

const handler = new RPCHandler(appRouter, {
  plugins: [new SimpleCsrfProtectionHandlerPlugin()],
});

export function registerOrpcRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/orpc/*",
    handler: async (request, reply) => {
      const { matched } = await handler.handle(request, reply, {
        prefix: "/api/orpc",
        context: await createORPCContext({ __AUTH_ARG__, headers: headersFromRequest(request.headers) }),
      });

      if (!matched) reply.callNotFound();
    },
  });
}
