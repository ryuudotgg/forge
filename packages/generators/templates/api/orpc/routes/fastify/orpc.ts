import { appRouter, reportServerError } from "@__SLUG__/orpc";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fastify";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import type { FastifyInstance, FastifyRequest } from "fastify";

__HEADERS_FROM_REQUEST__

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
