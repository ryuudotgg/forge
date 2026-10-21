import { auth } from "@__SLUG__/auth";
import { forwardedFor } from "@__SLUG__/auth/client-address";
import { toNodeHandler } from "better-auth/node";
import type { Express, NextFunction, Request, Response } from "express";

export function registerAuthRoutes(app: Express) {
  app.all("/api/auth/*splat", anchorClientAddress, toNodeHandler(auth));
}

function anchorClientAddress(req: Request, _res: Response, next: NextFunction) {
  const inbound = req.headers["x-forwarded-for"];
  const address = forwardedFor(
    Array.isArray(inbound) ? inbound.join(", ") : inbound,
    req.socket.remoteAddress,
  );

  if (address === undefined) delete req.headers["x-forwarded-for"];
  else req.headers["x-forwarded-for"] = address;

  next();
}
