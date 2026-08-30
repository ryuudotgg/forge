import { auth } from "@__SLUG__/auth";
import { toNodeHandler } from "better-auth/node";
import type { Express } from "express";

export function registerAuthRoutes(app: Express) {
  app.all("/api/auth/*splat", toNodeHandler(auth));
}
