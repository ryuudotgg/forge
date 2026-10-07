import { appRouter, reportServerError } from "@__SLUG__/orpc";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fastify";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import type { FastifyInstance, FastifyRequest } from "fastify";

__HEADERS_FROM_REQUEST__

const maxBodySize = 1024 * 1024;

const handler = new RPCHandler(appRouter, {
  plugins: [new SimpleCsrfProtectionHandlerPlugin()],
  adapterInterceptors: [
    async (options) => {
      const raw = options.request.raw;
      const declared = Number(raw.headers["content-length"]);
      const emit = raw.emit;
      let received = 0;

      raw.emit = (event: string | symbol, ...args: unknown[]) => {
        const [chunk] = args;
        if (event === "data" && chunk instanceof Uint8Array) {
          received += chunk.length;
          if (declared > maxBodySize || received > maxBodySize)
            throw new ORPCError("PAYLOAD_TOO_LARGE");
        }

        return emit.call(raw, event, ...args);
      };

      try {
        return await options.next();
      } finally {
        raw.emit = emit;
      }
    },
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
