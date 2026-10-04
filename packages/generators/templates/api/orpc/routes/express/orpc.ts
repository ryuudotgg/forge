__AUTH_IMPORT__;
import { appRouter, createORPCContext } from "@__SLUG__/orpc";
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
});

export function registerOrpcRoutes(app: Express) {
  app.use(async (request, response, next) => {
    const { matched } = await handler.handle(request, response, {
      prefix: "/api/orpc",
      context: await createORPCContext({ __AUTH_ARG__, headers: headersFromRequest(request.headers) }),
    });

    if (!matched) next();
  });
}
