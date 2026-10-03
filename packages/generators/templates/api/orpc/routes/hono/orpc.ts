__AUTH_IMPORT__;
import { appRouter, createORPCContext } from "@__SLUG__/orpc";
import { RPCHandler } from "@orpc/server/fetch";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "../../env.js";

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
});

orpcRoutes.use("/api/orpc/*", async (c, next) => {
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: "/api/orpc",
    context: await createORPCContext({ __AUTH_ARG__, headers: c.req.raw.headers }),
  });

  if (matched) return c.newResponse(response.body, response);

  await next();
});
