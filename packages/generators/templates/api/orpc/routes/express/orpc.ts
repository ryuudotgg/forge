import { appRouter, reportServerError } from "@__SLUG__/orpc";
import { onError } from "@orpc/server";
import { BodyLimitPlugin, RPCHandler } from "@orpc/server/node";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import type { Express, Request } from "express";

__HEADERS_FROM_REQUEST__

const handler = new RPCHandler(appRouter, {
  plugins: [
    new SimpleCsrfProtectionHandlerPlugin(),
    new BodyLimitPlugin({ maxBodySize: 1024 * 1024 }),
  ],
  interceptors: [
    onError((error, { request }) =>
      reportServerError(error, request.url.pathname),
    ),
  ],
});

export function registerOrpcRoutes(app: Express) {
  app.use(async (request, response, next) => {
    if (!request.path.startsWith("/api/orpc/")) return next();

    const { matched } = await handler.handle(request, response, {
      prefix: "/api/orpc",
      context: { headers: headersFromRequest(request.headers) },
    });

    if (!matched) next();
  });
}
