import type { Readable } from "node:stream";
import { appRouter, reportServerError } from "@__SLUG__/orpc";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fastify";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import type { FastifyInstance, FastifyRequest } from "fastify";

__HEADERS_FROM_REQUEST__

__LIMIT_BODY__

const handler = new RPCHandler(appRouter, {
  plugins: [new SimpleCsrfProtectionHandlerPlugin()],
  adapterInterceptors: [
    (options) => limitBody(options.request.raw, () => options.next()),
  ],
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
