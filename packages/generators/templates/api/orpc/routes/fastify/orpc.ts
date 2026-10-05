import { appRouter, reportServerError } from "@__SLUG__/orpc";
import { onError } from "@orpc/server";
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
  interceptors: [
    onError((error, { request }) =>
      reportServerError(error, request.url.pathname),
    ),
  ],
});

export function registerOrpcRoutes(app: FastifyInstance) {
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, _payload, done) =>
      done(null, undefined),
    );

    scope.route({
      method: ["GET", "POST"],
      url: "/api/orpc/*",
      handler: async (request, reply) => {
        const { matched } = await handler.handle(request, reply, {
          prefix: "/api/orpc",
          context: { headers: headersFromRequest(request.headers) },
        });

        if (!matched) reply.callNotFound();
      },
    });
  });
}
