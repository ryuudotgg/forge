import { auth } from "@__SLUG__/auth";
import { withClientAddress } from "@__SLUG__/auth/client-address";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { __SERVER_ENV_BINDING__ } from "../../env.js";

export const authRoutes = new Hono();

authRoutes.use(
  "/api/auth/*",
  cors({
    origin: __WEB_ORIGINS__,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

authRoutes.on(["POST", "GET"], "/api/auth/*", (c) =>
  auth.handler(withClientAddress(c.req.raw, getConnInfo(c).remote.address)),
);
