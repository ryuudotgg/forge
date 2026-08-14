import { auth } from "@__SLUG__/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "../../env.js";

export const authRoutes = new Hono();

authRoutes.use(
  "/api/auth/*",
  cors({
    origin: env.WEB_URL,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

authRoutes.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
