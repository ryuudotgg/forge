import { appRouter, reportServerError } from "@__SLUG__/orpc";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { __SERVER_ENV_BINDING__ } from "../../env.js";

export const orpcRoutes = new Hono();

orpcRoutes.use(
  "/api/orpc/*",
  cors({
    origin: __WEB_ORIGINS__,
    allowHeaders: ["Content-Type", "x-csrf-token"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

const handler = new RPCHandler(appRouter, {
  plugins: [new SimpleCsrfProtectionHandlerPlugin()],
  interceptors: [
    onError((error, { request }) =>
      reportServerError(error, request.url.pathname),
    ),
  ],
});

orpcRoutes.use("/api/orpc/*", async (c, next) => {
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: "/api/orpc",
    context: { headers: c.req.raw.headers },
  });

  if (matched) return c.newResponse(response.body, response);

  await next();
});
