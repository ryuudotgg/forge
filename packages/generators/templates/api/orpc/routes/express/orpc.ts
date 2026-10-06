import { appRouter, reportServerError } from "@__SLUG__/orpc";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import type { Express, Request } from "express";

function headersFromRequest(headers: Request["headers"]) {
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
