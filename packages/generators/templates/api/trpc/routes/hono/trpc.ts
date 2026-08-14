// __AUTH_IMPORT__
import { appRouter, createTRPCContext } from "@__SLUG__/trpc";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "../../env.js";

export const trpcRoutes = new Hono();

trpcRoutes.use(
  "/api/trpc/*",
  cors({
    origin: env.WEB_URL,
    allowHeaders: ["Content-Type", "Authorization", "x-trpc-source"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

trpcRoutes.use(
  "/api/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext: (_opts, c) =>
      createTRPCContext({ /* __AUTH_ARG__ */ headers: c.req.raw.headers }),
  }),
);
